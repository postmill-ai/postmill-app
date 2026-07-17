import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { FfmpegVideoEncoderService } from './ffmpeg-video-encoder.service';
import { PodmanRenderService } from './podman-render.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { inngest, isInngestEnabled } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { mediaJobWebhookToken } from '@gitroom/nestjs-libraries/media/media-job-token';
import { isPodmanRenderEnabled, getRenderTimeoutMs } from './render-config';
import { DesignRenderJobSpec, MergeRenderJobSpec, renderWorkDir } from './render-job-spec';
import { mergeLocalFiles } from '@gitroom/nestjs-libraries/media/replicate-studio/video-merge';
import {
  MAX_DIMENSION,
  MAX_TRACKS,
  MAX_CLIPS_PER_TRACK,
} from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.limits';
import * as fs from 'fs';
import * as path from 'path';

const MAX_DURATION_MS = 60000;
const MAX_FPS = 240;
const RENDER_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

function payloadKey(jobId: string): string {
  return `video-render:payload:${jobId}`;
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
  ) {}

  async enqueueRender(
    orgId: string,
    body: {
      composition: any;
      outputIndex?: number;
      format?: string;
      quality?: number;
      bitrateKbps?: number;
      posterUrl?: string;
      folderId?: string;
    },
  ) {
    const composition = body.composition || {};
    const durationMs = composition.durationMs || 10000;
    if (durationMs > MAX_DURATION_MS) {
      throw new Error(
        `Composition duration ${durationMs}ms exceeds the 60 s hard cap`,
      );
    }
    validateVideoComposition(composition);

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
      posterUrl: body.posterUrl,
      folderId: body.folderId,
      enqueuedAt: new Date().toISOString(),
    };

    await ioRedis.set(
      payloadKey(job.id),
      JSON.stringify(payload),
      'EX',
      RENDER_PAYLOAD_TTL_SECONDS,
    );

    await this.dispatch(job.id, 'design');

    this.logger.log(`Enqueued video render job ${job.id} for org ${orgId}`);
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

  async processVideoRender(jobId: string) {
    // Job-id-only Inngest entry point: unscoped lookup, then all updates are org-scoped.
    const job = await this._aiSettings.getMediaJobByIdUnscoped(jobId);
    if (!job || job.provider !== 'chromium-ffmpeg' || job.status !== 'pending') {
      return;
    }
    const orgId = job.organizationId;

    let workDir: string | undefined;

    try {
      await this._aiSettings.updateMediaJob(orgId, jobId, { status: 'processing' });

      // Atomically claim the render payload: GETDEL is a single Redis op, so exactly one
      // concurrent runner obtains it (the equivalent of an `updateMany` count===1 claim).
      // A loser sees null here and must NOT mark the job failed — the winner is rendering it.
      const raw = await ioRedis.getdel(payloadKey(jobId));
      if (!raw) {
        const current = await this._aiSettings.getMediaJobById(orgId, jobId);
        if (current && current.status !== 'pending') {
          this.logger.log(
            `Render ${jobId} already claimed by another runner; skipping duplicate`,
          );
          return;
        }
        throw new Error(`No pending composition found for job ${jobId}`);
      }
      const input = JSON.parse(raw);

      const composition = input.composition || {};
      const fps = composition.fps || 30;
      const durationMs = composition.durationMs || 10000;
      if (durationMs > MAX_DURATION_MS) {
        throw new Error(
          `Composition duration ${durationMs}ms exceeds the 60 s hard cap`,
        );
      }
      validateVideoComposition(composition);

      const format = ['webm', 'gif', 'webp-animated'].includes(input.format)
        ? input.format
        : 'mp4';
      const renderToken = mediaJobWebhookToken(jobId, job.organizationId);
      const options = {
        fps,
        bitrateKbps: input.bitrateKbps || composition.bitrateKbps || 8000,
        format: format as DesignRenderJobSpec['options']['format'],
        quality: input.quality,
        jobId,
        orgId: job.organizationId,
        renderToken,
      };

      let videoPath: string;
      let thumbnailPath: string;
      if (isPodmanRenderEnabled()) {
        workDir = renderWorkDir(jobId);
        fs.mkdirSync(workDir, { recursive: true });
        const spec: DesignRenderJobSpec = { op: 'design', composition, options, baseUrl: baseUrl() };
        await this._podman.run(workDir, spec);
        videoPath = path.join(workDir, 'out', `output.${format}`);
        thumbnailPath = path.join(workDir, 'out', 'thumbnail.jpg');
      } else {
        // The in-process encoder has no external timeout (only Podman enforces one);
        // cap its wall-clock so a pathological composition can't pin a worker forever.
        const result = await withTimeout(
          this._encoder.encode(composition, options),
          getRenderTimeoutMs(),
          'In-process video encode',
        );
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

      const ok = await this._lifecycle.completeJobWithBuffer(
        job,
        videoBuffer,
        mimeType,
        {
          width: composition.width,
          height: composition.height,
          durationSeconds: durationMs / 1000,
          fps,
          provider: 'chromium-ffmpeg',
        },
        thumbnailBuffer,
      );

      if (!ok) {
        throw new Error('Lifecycle service failed to store artifact');
      }
    } catch (err) {
      this.logger.error(
        `Video render failed: ${jobId}: ${(err as Error).message}`,
      );
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: (err as Error).message.slice(0, 1000),
      });
    } finally {
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
      await this._aiSettings.updateMediaJob(orgId, jobId, {
        status: 'failed',
        error: (err as Error).message.slice(0, 1000),
      });
    } finally {
      this.cleanupWorkDir(workDir);
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
