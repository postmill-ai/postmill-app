import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { FfmpegVideoEncoderService, formatExtension } from './ffmpeg-video-encoder.service';
import { PodmanRenderService } from './podman-render.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { inngest, isInngestEnabled } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';
import { mediaJobWebhookToken } from '@postmill-ai/nestjs-libraries/media/media-job-token';
import { isPodmanRenderEnabled, getRenderTimeoutMs } from './render-config';
import { DesignRenderJobSpec, MergeRenderJobSpec, renderWorkDir } from './render-job-spec';
import {
  renderPayloadKey,
  renderProgressKey,
  readRenderProgress,
  writeRenderProgress,
} from './render-progress';
import type { RenderProgress } from './render-progress';
import { createThrottledProgressWriter } from './render-progress-throttle';
import { mergeLocalFiles } from '@postmill-ai/nestjs-libraries/media/replicate-studio/video-merge';
import {
  MAX_DIMENSION,
  MAX_TRACKS,
  MAX_CLIPS_PER_TRACK,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { capCompositionDuration } from '@postmill-ai/nestjs-libraries/media/designer-doc/composition-cap';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { DesignService } from '@postmill-ai/nestjs-libraries/database/prisma/design/design.service';
import * as fs from 'fs';
import * as path from 'path';

// Lockstep with MAX_VIDEO_DURATION_MS (media/designer-doc/designer-doc.limits.ts) and
// the frontend store clamp — the designer-doc drift spec enforces they stay equal.
const MAX_DURATION_MS = 180_000;
const MAX_FPS = 240;
const RENDER_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

/**
 * Animated template previews: only the opening seconds, at reduced fps and
 * half resolution — a background nicety, so it must stay far cheaper than a
 * real export (3000 ms × 12 fps = 36 frames at 0.5×).
 */
export const TEMPLATE_PREVIEW_DURATION_MS = 3000;
export const TEMPLATE_PREVIEW_FPS = 12;
export const TEMPLATE_PREVIEW_SCALE = 0.5;

/**
 * Credit sentinel for renders that must never consume a `video_export`
 * credit (template previews). Distinct from NULL on purpose: merge jobs run
 * with a NULL creditType and ARE charged — a null-means-free rule would
 * silently unmeter them. The VIDEO_EXPORTS in-flight gate counts only
 * `creditType: 'video_export'` rows, so 'none' jobs never hold a slot either.
 */
export const NO_CREDIT = 'none';

/**
 * Per-frame wall-clock budget for scaling the render timeout. The capture loop
 * (chromium-frame-capture.service.ts) does one page.evaluate + one PNG screenshot
 * per frame — ~150 ms/frame at 1080p on a single page. A 180 s @ 30 fps composition
 * is 5400 frames ≈ 810 s sequential, which blows past the 120 s default, so the
 * budget scales with frames (parallel capture spreads it across pages; the budget
 * stays conservative either way). The budget is further multiplied by scale² — a 2×
 * export rasterizes and PNG-encodes 4× the pixels per frame. Exported for unit
 * testing.
 */
export const PER_FRAME_CAPTURE_BUDGET_MS = 150;

/**
 * Wall-clock budget for one render: max(env floor, frames × per-frame budget × scale²).
 * scale² because a 2× export rasterizes and PNG-encodes 4× the pixels per frame.
 */
export function computeRenderTimeoutMs(
  durationMs: number,
  fps: number,
  scale = 1,
): number {
  const frames = Math.max(1, Math.ceil((durationMs / 1000) * fps));
  return Math.max(
    getRenderTimeoutMs(),
    Math.ceil(frames * PER_FRAME_CAPTURE_BUDGET_MS * scale * scale),
  );
}

/** Exactly-once claim marker (SET NX) for a render job — the payload key itself must survive the render. */
function claimKey(jobId: string): string {
  return `video-render:claim:${jobId}`;
}

function mergePayloadKey(jobId: string): string {
  return `video-render:merge:${jobId}`;
}

/** Deterministic media/render event id so a re-dispatch inside the same minute dedups. */
function renderEventId(jobId: string): string {
  return `media-render-${jobId}-${Math.floor(Date.now() / 60000)}`;
}

/**
 * Bound-check an attacker-controlled video composition before it drives Puppeteer/FFmpeg.
 * Rejects out-of-range dims/fps/track/clip counts (a `100000x100000` viewport or `fps:100000`
 * exhausts memory / produces millions of screenshots — a resource DoS). Mirrors the bounds in
 * designer-doc.schema.ts (StrictVideoOutputSchema) without full strict-parsing so legitimate
 * extra fields on the composition are not rejected.
 */
function validateVideoComposition(composition: any): void {
  const width = composition?.width;
  const height = composition?.height;
  const fps = composition?.fps ?? 30;

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    throw new BadRequestException(
      `Composition dimensions ${width}x${height} are out of range (1..${MAX_DIMENSION})`,
    );
  }
  if (!Number.isFinite(fps) || fps < 1 || fps > MAX_FPS) {
    throw new BadRequestException(`Composition fps ${fps} is out of range (1..${MAX_FPS})`);
  }

  const tracks = Array.isArray(composition?.tracks) ? composition.tracks : [];
  if (tracks.length > MAX_TRACKS) {
    throw new BadRequestException(`Composition has ${tracks.length} tracks (max ${MAX_TRACKS})`);
  }
  for (const track of tracks) {
    const clips = Array.isArray(track?.clips) ? track.clips : [];
    if (clips.length > MAX_CLIPS_PER_TRACK) {
      throw new BadRequestException(
        `Composition track has ${clips.length} clips (max ${MAX_CLIPS_PER_TRACK})`,
      );
    }
  }
}

/** Reject a promise if it does not settle within `ms` (in-process encoder wall-clock cap). Exported for unit testing. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded the ${ms}ms wall-clock timeout`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

@Injectable()
export class VideoRenderService {
  private readonly logger = new Logger(VideoRenderService.name);

  constructor(
    private _lifecycle: MediaJobLifecycleService,
    private _aiSettings: AiSettingsService,
    private _encoder: FfmpegVideoEncoderService,
    private _podman: PodmanRenderService,
    private _fileService: FileService,
    private _designService: DesignService,
  ) {}

  async enqueueRender(
    orgId: string,
    body: {
      composition: any;
      outputIndex?: number;
      format?: string;
      quality?: number;
      bitrateKbps?: number;
      /** Resolution multiplier over the canvas size (0.5 | 1 | 2); default 1. */
      scale?: number;
      /** Frame-rate override (24 | 30 | 60); default = composition.fps. */
      fps?: number;
      posterUrl?: string;
      folderId?: string;
    },
  ) {
    const composition = body.composition || {};
    const scale = body.scale || 1;
    const fps = body.fps || composition.fps || 30;
    const durationMs = composition.durationMs || 10000;
    if (durationMs > MAX_DURATION_MS) {
      throw new Error(
        `Composition duration ${durationMs}ms exceeds the 180 s hard cap`,
      );
    }
    // Bounds apply to the EFFECTIVE render: a 2× 1080×1080 @60fps job must pass
    // (2160 ≤ MAX_DIMENSION, 60 ≤ MAX_FPS) while a 2× near-max canvas is rejected.
    validateVideoComposition({
      ...composition,
      width: Math.round((composition.width || 0) * scale),
      height: Math.round((composition.height || 0) * scale),
      fps,
    });

    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      provider: 'chromium-ffmpeg',
      operation: 'video',
      costUsd: 0,
      creditType: 'video_export',
    });

    const payload = {
      organizationId: orgId,
      composition: body.composition,
      outputIndex: body.outputIndex,
      format: body.format,
      quality: body.quality,
      bitrateKbps: body.bitrateKbps,
      scale: body.scale,
      fps: body.fps,
      posterUrl: body.posterUrl,
      folderId: body.folderId,
      enqueuedAt: new Date().toISOString(),
    };

    await ioRedis.set(
      renderPayloadKey(job.id),
      JSON.stringify(payload),
      'EX',
      RENDER_PAYLOAD_TTL_SECONDS,
    );

    await this.dispatch(job.id, 'design');

    this.logger.log(`Enqueued video render job ${job.id} for org ${orgId}`);
    return { id: job.id, status: job.status };
  }

  /**
   * Enqueue a cheap animated preview (first TEMPLATE_PREVIEW_DURATION_MS of the
   * composition, reduced fps, half scale, animated WebP) whose artifact becomes the
   * template's thumbnail on completion. Fire-and-forget from template save: the
   * static JPEG thumbnail stays as the fallback if this render fails. No
   * `video_export` credit is charged (NO_CREDIT sentinel — see media-jobs.activity).
   */
  async enqueueTemplatePreview(orgId: string, templateId: string, composition: any) {
    const capped = capCompositionDuration(
      composition || {},
      TEMPLATE_PREVIEW_DURATION_MS,
    );
    if (!capped.durationMs || !capped.tracks?.length) {
      return null;
    }
    const scale = TEMPLATE_PREVIEW_SCALE;
    const fps = TEMPLATE_PREVIEW_FPS;
    // Same bounds as a real export: the preview composition is derived from a
    // validated stored doc, but the check is cheap and keeps one DoS boundary.
    validateVideoComposition({
      ...capped,
      width: Math.round((capped.width || 0) * scale),
      height: Math.round((capped.height || 0) * scale),
      fps,
    });

    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      provider: 'chromium-ffmpeg',
      operation: 'video',
      costUsd: 0,
      creditType: NO_CREDIT,
    });

    const payload = {
      organizationId: orgId,
      composition: capped,
      format: 'webp-animated',
      scale,
      fps,
      templateId,
      enqueuedAt: new Date().toISOString(),
    };

    await ioRedis.set(
      renderPayloadKey(job.id),
      JSON.stringify(payload),
      'EX',
      RENDER_PAYLOAD_TTL_SECONDS,
    );

    await this.dispatch(job.id, 'design');

    this.logger.log(
      `Enqueued template preview render job ${job.id} for template ${templateId} (org ${orgId})`,
    );
    return { id: job.id, status: job.status };
  }

  /**
   * Enqueue a clip-merge render. Clips are resolved to raw files in the job's workdir
   * up-front (storage stays host-side); the ffmpeg trim+xfade runs later in the worker.
   */
  async enqueueMerge(
    orgId: string,
    job: { id: string },
    clips: Array<{ trimStart?: number; trimEnd?: number }>,
    transitions: Array<{ type: string; duration?: number }>,
    folderId?: string | null,
  ) {
    await ioRedis.set(
      mergePayloadKey(job.id),
      JSON.stringify({ organizationId: orgId, clips, transitions, folderId }),
      'EX',
      RENDER_PAYLOAD_TTL_SECONDS,
    );
    await this.dispatch(job.id, 'merge');
    return { jobId: job.id };
  }

  /** Send the media/render event (Inngest enforces the 3-concurrent limit). */
  private async dispatch(jobId: string, op: 'design' | 'merge') {
    if (isInngestEnabled()) {
      // Deterministic event id: a same-minute re-dispatch (initial enqueue + the sweep's
      // re-enqueue) dedups instead of stacking duplicate render runs.
      await inngest.send({ name: 'media/render', data: { jobId, op }, id: renderEventId(jobId) });
    }
  }

  async getJob(orgId: string, jobId: string) {
    // Org-scope the read: never return another org's job status / artifactUrl / error for a
    // guessed or leaked job id. Mirrors HeyGenService.getJob / ReplicateRunnerService.getJob.
    const job = await this._aiSettings.getMediaJobById(orgId, jobId);
    if (!job || job.organizationId !== orgId) return null;
    return job;
  }

  /**
   * Live frame-capture progress for a processing job (written by the render itself,
   * throttled). Null when nothing has been reported yet — the status endpoint keeps
   * its static fallback in that case.
   */
  async getRenderProgress(jobId: string): Promise<RenderProgress | null> {
    return readRenderProgress(jobId);
  }

  async processVideoRender(jobId: string) {
    // Job-id-only Inngest entry point: unscoped lookup, then all updates are org-scoped.
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job || job.provider !== 'chromium-ffmpeg' || job.status !== 'pending') {
      return;
    }
    const orgId = job.organizationId;

    let workDir: string | undefined;
    let claimed = false;

    try {
      await this._aiSettings.updateMediaJob(orgId, jobId, { status: 'processing' });

      // Read the payload WITHOUT deleting it: the render-frame route serves this
      // key to headless Chromium (possibly repeatedly) while the encode runs, so a
      // GETDEL here 404s the frame page and the render times out waiting for
      // __FRAME_API. Exactly-once claiming moves to a SET NX marker: a loser (claim
      // already held by another runner) must NOT mark the job failed — the winner
      // is rendering it. A null payload with the job still pending means the TTL
      // expired — a genuine failure.
      const raw = await ioRedis.get(renderPayloadKey(jobId));
      claimed =
        raw != null &&
        (await ioRedis.set(claimKey(jobId), '1', 'EX', RENDER_PAYLOAD_TTL_SECONDS, 'NX')) !==
          null;
      if (!raw || !claimed) {
        const current = await this._aiSettings.getMediaJobById(orgId, jobId);
        if (current && current.status !== 'pending') {
          this.logger.log(
            `Render ${jobId} already claimed by another runner; skipping duplicate`,
          );
          return;
        }
        if (!raw) {
          throw new Error(`No pending composition found for job ${jobId}`);
        }
        throw new Error(`Render claim for job ${jobId} is held while the job is still pending`);
      }
      // Re-store the payload for the render's duration: the headless page loads
      // the composition from `GET /media/designs/render-frame/:jobId` (token-
      // gated), which reads this same key — GETDEL alone left it 404ing. The
      // single-winner claim already happened; re-publishing does not weaken it.
      // The key is deleted again in the finally below.
      await ioRedis.set(renderPayloadKey(jobId), raw, 'EX', RENDER_PAYLOAD_TTL_SECONDS);
      const input = JSON.parse(raw);

      const composition = input.composition || {};
      const scale = typeof input.scale === 'number' && input.scale > 0 ? input.scale : 1;
      const fps = input.fps || composition.fps || 30;
      const durationMs = composition.durationMs || 10000;
      if (durationMs > MAX_DURATION_MS) {
        throw new Error(
          `Composition duration ${durationMs}ms exceeds the 180 s hard cap`,
        );
      }
      validateVideoComposition({
        ...composition,
        width: Math.round((composition.width || 0) * scale),
        height: Math.round((composition.height || 0) * scale),
        fps,
      });

      const format = ['webm', 'gif', 'webp-animated'].includes(input.format)
        ? input.format
        : 'mp4';
      const renderToken = mediaJobWebhookToken(jobId, job.organizationId);
      const options = {
        fps,
        scale,
        bitrateKbps: input.bitrateKbps || composition.bitrateKbps || 8000,
        format: format as DesignRenderJobSpec['options']['format'],
        quality: input.quality,
        jobId,
        orgId: job.organizationId,
        renderToken,
      };

      // Scale the wall-clock budget with the frame count (see
      // PER_FRAME_CAPTURE_BUDGET_MS): the env floor alone cannot fit a long
      // composition's sequential frame captures, and the per-frame budget
      // scales with pixel area (scale²). Applies to both render paths.
      const renderTimeoutMs = computeRenderTimeoutMs(durationMs, fps, scale);

      let videoPath: string;
      let thumbnailPath: string;
      if (isPodmanRenderEnabled()) {
        workDir = renderWorkDir(jobId);
        fs.mkdirSync(workDir, { recursive: true });
        const spec: DesignRenderJobSpec = { op: 'design', composition, options, baseUrl: baseUrl() };
        await this._podman.run(workDir, spec, renderTimeoutMs);
        videoPath = path.join(workDir, 'out', `output.${formatExtension(format)}`);
        thumbnailPath = path.join(workDir, 'out', 'thumbnail.jpg');
      } else {
        // Real render progress: the capture loop reports each captured frame
        // (global count, even under parallel capture); the throttled writer lands
        // it in Redis (every 10 frames / 2s, whichever first) for the status endpoint.
        const progress = createThrottledProgressWriter((frame, total) =>
          writeRenderProgress(jobId, frame, total),
        );
        // The in-process encoder has no external timeout (only Podman enforces one);
        // cap its wall-clock so a pathological composition can't pin a worker forever.
        const result = await withTimeout(
          this._encoder.encode(composition, {
            ...options,
            onProgress: (p) => progress.report(p.frame, p.total),
          }),
          renderTimeoutMs,
          'In-process video encode',
        );
        await progress.flush();
        videoPath = result.videoPath;
        thumbnailPath = result.thumbnailPath;
        workDir = path.dirname(videoPath);
      }

      const videoBuffer = fs.readFileSync(videoPath);
      const thumbnailBuffer = fs.existsSync(thumbnailPath)
        ? fs.readFileSync(thumbnailPath)
        : undefined;

      const mimeType =
        format === 'webm'
          ? 'video/webm'
          : format === 'gif'
            ? 'image/gif'
            : format === 'webp-animated'
              ? 'image/webp'
              : 'video/mp4';

      // A template preview (payload.templateId) IS the thumbnail — skip the
      // extra JPEG thumbnail artifact, mark the file internal so it stays out
      // of the media library listing, and don't notify the org about a
      // background render it never asked for. The plain-export call shape is
      // unchanged (folderId/options only ride the preview path).
      const isTemplatePreview = typeof input.templateId === 'string' && !!input.templateId;
      const metadata = {
        width: Math.round((composition.width || 0) * scale),
        height: Math.round((composition.height || 0) * scale),
        durationSeconds: durationMs / 1000,
        fps,
        provider: 'chromium-ffmpeg',
      };

      const ok = isTemplatePreview
        ? await this._lifecycle.completeJobWithBuffer(
            job,
            videoBuffer,
            mimeType,
            { ...metadata, internal: 'design-preview' },
            undefined,
            undefined,
            { notify: false },
          )
        : await this._lifecycle.completeJobWithBuffer(
            job,
            videoBuffer,
            mimeType,
            metadata,
            thumbnailBuffer,
          );

      if (!ok) {
        throw new Error('Lifecycle service failed to store artifact');
      }

      if (isTemplatePreview) {
        await this.linkTemplatePreview(orgId, jobId, input.templateId);
      }
    } catch (err) {
      this.logger.error(
        `Video render failed: ${jobId}: ${(err as Error).message}`,
      );
      Sentry.captureException(err, { tags: { subsystem: 'video-render' } });
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: (err as Error).message.slice(0, 1000),
      });
    } finally {
      if (claimed) {
        // The render concluded (success or failure) — release the payload and the
        // claim marker. Never touch these keys when we lost the claim race: they
        // belong to the winning runner, which may still be rendering.
        await this.releasePayload(jobId);
      }
      this.cleanupWorkDir(workDir);
    }
  }

  async processMergeRender(jobId: string) {
    // Job-id-only Inngest entry point: unscoped lookup, then all updates are org-scoped.
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job || job.model !== 'local/ffmpeg-merge' || job.status !== 'pending') {
      return;
    }
    const orgId = job.organizationId;

    const workDir = renderWorkDir(jobId);

    try {
      await this._aiSettings.updateMediaJob(orgId, jobId, { status: 'processing' });

      // Atomic single-winner claim (see processVideoRender): a loser skips silently.
      const raw = await ioRedis.getdel(mergePayloadKey(jobId));
      if (!raw) {
        const current = await this._aiSettings.getMediaJobById(orgId, jobId);
        if (current && current.status !== 'pending') {
          this.logger.log(
            `Merge ${jobId} already claimed by another runner; skipping duplicate`,
          );
          return;
        }
        throw new Error(`No pending merge payload found for job ${jobId}`);
      }
      const input = JSON.parse(raw) as {
        clips: Array<{ trimStart?: number; trimEnd?: number }>;
        transitions: Array<{ type: string; duration?: number }>;
        folderId?: string | null;
      };

      const outDir = path.join(workDir, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const outputPath = path.join(outDir, 'output.mp4');

      if (isPodmanRenderEnabled()) {
        const spec: MergeRenderJobSpec = {
          op: 'merge',
          files: input.clips.map((c, i) => ({
            name: `raw_${i}.mp4`,
            trimStart: c.trimStart,
            trimEnd: c.trimEnd,
          })),
          transitions: input.transitions,
        };
        await this._podman.run(workDir, spec);
      } else {
        const inputs = input.clips.map((c, i) => ({
          path: path.join(workDir, `raw_${i}.mp4`),
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
        }));
        await mergeLocalFiles(inputs, input.transitions, workDir, outputPath);
      }

      const buffer = fs.readFileSync(outputPath);
      const ok = await this._lifecycle.completeJobWithBuffer(
        job,
        buffer,
        'video/mp4',
        { provider: 'replicate' },
        undefined,
        input.folderId ?? undefined,
      );
      if (!ok) {
        throw new Error('Lifecycle service failed to store merge artifact');
      }
    } catch (err) {
      this.logger.error(`Merge render failed: ${jobId}: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'video-render', op: 'merge' } });
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: (err as Error).message.slice(0, 1000),
      });
    } finally {
      this.cleanupWorkDir(workDir);
    }
  }

  /**
   * Point a template's thumbnail at the freshly rendered animated preview file.
   * Best-effort: the static JPEG uploaded at template save stays as the
   * fallback, so a link failure is logged, never thrown. `updateTemplate`
   * soft-deletes the replaced static thumbnail file itself.
   */
  private async linkTemplatePreview(orgId: string, jobId: string, templateId: string) {
    try {
      const template = await this._designService.getTemplate(orgId, templateId);
      if (!template) {
        this.logger.warn(
          `Template preview ${jobId}: template ${templateId} no longer exists; leaving static thumbnail`,
        );
        return;
      }
      const completed = await this._aiSettings.getMediaJobById(orgId, jobId);
      const file = completed?.artifactUrl
        ? await this._fileService.getFileByPath(orgId, completed.artifactUrl)
        : null;
      if (!file) {
        this.logger.warn(`Template preview ${jobId}: stored artifact file not found`);
        return;
      }
      await this._designService.updateTemplate(orgId, templateId, {
        thumbnailFileId: file.id,
      });
      this.logger.log(`Template ${templateId} thumbnail set to animated preview ${file.id}`);
    } catch (err) {
      this.logger.warn(
        `Linking template preview ${jobId} to template ${templateId} failed: ${(err as Error).message}`,
      );
    }
  }

  /** Best-effort release of the render payload + claim marker + progress key after a render concludes. */
  private async releasePayload(jobId: string) {
    try {
      await ioRedis.del(renderPayloadKey(jobId), claimKey(jobId), renderProgressKey(jobId));
    } catch (err) {
      this.logger.warn(
        `Failed to release render payload keys for ${jobId}: ${(err as Error).message}`,
      );
    }
  }

  private cleanupWorkDir(dir?: string) {
    if (!dir) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
