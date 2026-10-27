import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { upstreamErrorFromResponse } from '@postmill-ai/provider-kernel';
import { ReplicateCatalogService } from './replicate-catalog.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { MediaJobLifecycleService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { OrgMediaProviderSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { FileService } from '@postmill-ai/nestjs-libraries/database/prisma/file/file.service';
import { estimate } from './replicate-cost';
import { isWarm, MODEL_ALLOWLIST } from './replicate-catalog.allowlist';
import { VideoRenderService } from '@postmill-ai/nestjs-libraries/media/design-render/video-render.service';
import { renderWorkDir } from '@postmill-ai/nestjs-libraries/media/design-render/render-job-spec';
import * as fs from 'fs';
import { presentMediaMetadata } from '@postmill-ai/nestjs-libraries/media/video-artifact';

const BASE = 'https://api.replicate.com/v1';

// Same attribution the provider adapter uses (media.adapter.ts), so a
// create-time 422 reaches the user verbatim through ProviderExceptionFilter
// instead of a masked 500 "Replicate run failed".
const UPSTREAM_CTX = {
  domain: 'media',
  providerId: 'replicate',
  providerName: 'Replicate',
} as const;

interface ReplicatePrediction {
  id?: string;
  status?: string;
  output?: string | string[] | Record<string, unknown> | null;
  error?: string;
}

export interface RunSyncResult {
  status: 'succeeded' | 'pending' | 'error';
  kind: 'image' | 'text';
  urls?: string[];
  text?: string;
  segments?: Array<{ text: string; start?: number; end?: number }>;
  jobId?: string;
  error?: string;
}

export interface RunAsyncResult {
  jobId: string;
}

export interface GetJobResult {
  status: string;
  result: {
    kind: 'image' | 'video' | 'audio';
    urls: string[];
    fileId: string | null;
    fileType: string | null;
    metadata: ReturnType<typeof presentMediaMetadata>;
  } | null;
  // The real failure reason when status is 'failed' — the compact embeds
  // surface this instead of a generic "Generation failed".
  error: string | null;
}

@Injectable()
export class ReplicateRunnerService {
  private readonly _logger = new Logger(ReplicateRunnerService.name);

  // 1.5: flat set of every allowlisted "owner/name" model id. The catalog UI
  // only lists these, but `runSync`/`runAsync` took `body.modelId` straight to
  // Replicate — letting any `media:create` user run an arbitrary (billable)
  // model on the org's key. Enforce the allowlist at the runner boundary.
  private static readonly _allowedModels = new Set<string>(
    Object.values(MODEL_ALLOWLIST).flat()
  );

  private _assertModelAllowed(modelId: string): void {
    if (!ReplicateRunnerService._allowedModels.has(modelId)) {
      throw new BadRequestException(`Model "${modelId}" is not allowed`);
    }
  }

  constructor(
    private readonly _catalog: ReplicateCatalogService,
    private readonly _aiSettings: AiSettingsService,
    private readonly _lifecycle: MediaJobLifecycleService,
    private readonly _storage: StorageService,
    private readonly _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    private readonly _fileService: FileService,
    private readonly _videoRender: VideoRenderService,
  ) {}

  private async _getApiKey(orgId: string): Promise<string> {
    return this._catalog.getReplicateKey(orgId);
  }

  private async _resolveInputUrls(
    input: Record<string, unknown>,
    orgId: string,
  ): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = { ...input };
    for (const [key, value] of Object.entries(resolved)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        if (obj.fileId && typeof obj.fileId === 'string') {
          const fileRecord = await this._getFileRecord(obj.fileId, orgId);
          if (fileRecord) {
            resolved[key] = fileRecord.publicUrl;
          }
        }
      }
    }
    return resolved;
  }

  private async _getFileRecord(
    fileId: string,
    orgId: string,
  ): Promise<{ path: string; publicUrl: string; folderId: string | null } | null> {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file || file.organizationId !== orgId) {
      throw new ForbiddenException('File not found');
    }

    const publicUrl = await this._resolvePublicUrl(file, orgId);
    return { path: file.path, publicUrl, folderId: file.folderId };
  }

  private async _resolvePublicUrl(
    file: { path: string; folderId: string | null },
    orgId: string,
  ): Promise<string> {
    if (file.path.startsWith('https://')) {
      return file.path;
    }

    const adapter = file.folderId
      ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
      : await this._storage.getLocalAdapterForOrg(orgId, true);

    return adapter.getFileUrl(file.path);
  }

  private async _resolveFileId(
    fileId: string,
    orgId: string,
  ): Promise<string> {
    if (!fileId) {
      throw new Error('fileId is required');
    }
    const record = await this._getFileRecord(fileId, orgId);
    if (!record) {
      throw new Error(`File not found: ${fileId}`);
    }
    return record.path;
  }

  // riffusion's CLIP text encoder hard-caps prompts at 77 tokens (prod failure:
  // "Sizes of tensors must match... Expected size 77 but got size 154").
  // ~300 chars ≈ 75 tokens. The video models cap prompt length too (veo
  // rejects past ~1024 chars; kling ~2500; seedance ~2000 — over-long prompts
  // 422 the whole paid job). The studio/runner path bypasses the provider
  // adapter, so the rule is mirrored here — keep in sync with
  // _PROMPT_MAX_CHARS in libraries/providers/replicate/src/v1/media.adapter.ts.
  private static readonly _PROMPT_MAX_CHARS: Record<string, number> = {
    'riffusion/riffusion': 300,
    'google/veo-3.1': 1024,
    'bytedance/seedance-1-pro': 2000,
    'kwaivgi/kling-v2.5-turbo-pro': 2500,
  };

  private _sanitizeModelInput(
    modelId: string,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const maxChars = ReplicateRunnerService._PROMPT_MAX_CHARS[modelId];
    if (!maxChars) return input;
    let next = input;
    for (const key of ['prompt_a', 'prompt_b', 'prompt']) {
      const value = next[key];
      if (typeof value === 'string' && value.length > maxChars) {
        this._logger.warn(
          `${modelId} ${key} truncated from ${value.length} to ${maxChars} chars (upstream token limit)`,
        );
        next = { ...next, [key]: value.slice(0, maxChars) };
      }
    }
    return next;
  }

  private async _pickCall(
    modelId: string,
    input: Record<string, unknown>,
    apiKey: string,
    orgId: string,
    opts: { wait?: boolean; webhookUrl?: string; versionId?: string },
  ): Promise<ReplicatePrediction> {
    const warm = isWarm(modelId);
    input = this._sanitizeModelInput(modelId, input);

    if (warm) {
      const res = await safeFetch(`${BASE}/models/${modelId}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // `Prefer: wait` must stay under safeFetch's 30s budget (25s): a
          // 60s hold was aborted client-side first, orphaning a running —
          // and billing — prediction with no job row to track it.
          ...(opts.wait ? { Prefer: `wait=25` } : {}),
        },
        body: JSON.stringify({
          input,
          ...(opts.webhookUrl
            ? { webhook: opts.webhookUrl, webhook_events_filter: ['completed'] }
            : {}),
        }),
      });
      if (!res.ok) throw await upstreamErrorFromResponse(UPSTREAM_CTX, res);
      return (await res.json()) as ReplicatePrediction;
    }

    let versionId = opts.versionId;

    if (!versionId) {
      const [owner, name] = modelId.split('/');
      const model = await this._catalog.getModel(owner, name, orgId);
      if (!model.versionId) {
        throw new BadRequestException('Community model requires a version');
      }
      versionId = model.versionId;
    }

    const res = await safeFetch(`${BASE}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // See the warm-model branch: the hold must stay under safeFetch's 30s.
        ...(opts.wait ? { Prefer: `wait=25` } : {}),
      },
      body: JSON.stringify({
        version: versionId,
        input,
        ...(opts.webhookUrl
          ? { webhook: opts.webhookUrl, webhook_events_filter: ['completed'] }
          : {}),
      }),
    });
    if (!res.ok) throw await upstreamErrorFromResponse(UPSTREAM_CTX, res);
    return (await res.json()) as ReplicatePrediction;
  }

  private _normalizeSttOutput(
    output: unknown,
  ): {
    text: string;
    segments?: Array<{ text: string; start?: number; end?: number }>;
  } {
    if (typeof output === 'string') return { text: output };
    if (output && typeof output === 'object') {
      const obj = output as Record<string, unknown>;
      if (typeof obj.text === 'string')
        return { text: obj.text, segments: obj.segments as any };
      if (typeof obj.transcription === 'string')
        return { text: obj.transcription, segments: obj.segments as any };
      if (Array.isArray(obj.segments)) {
        const segments = obj.segments as Array<{
          text: string;
          start?: number;
          end?: number;
        }>;
        return { text: segments.map((s) => s.text).join(' '), segments };
      }
      return { text: JSON.stringify(output) };
    }
    return { text: String(output) };
  }

  private _normalizeUrls(
    output: string | string[] | Record<string, unknown> | null | undefined,
  ): string[] {
    if (!output) return [];
    if (Array.isArray(output))
      return output.filter((u): u is string => typeof u === 'string');
    if (typeof output === 'string') return [output];
    // Object outputs (named artifacts — e.g. riffusion's `{ audio, spectrogram }`).
    // Same preference order as the provider adapter's firstOutputUrl: exact
    // audio/video/image key → fuzzy key match → first non-empty string value.
    // Duplicated deliberately: nestjs-libraries does not depend on
    // @postmill-ai/provider-replicate (the kernel owns that package).
    const entries = Object.entries(output).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0
    );
    for (const key of ['audio', 'video', 'image']) {
      const hit = entries.find(([k]) => k === key);
      if (hit) return [hit[1]];
    }
    const fuzzy = entries.find(([k]) => /audio|video|image|url|output|file/i.test(k));
    if (fuzzy) return [fuzzy[1]];
    const first = entries[0]?.[1];
    return first ? [first] : [];
  }

  private async _withCredit<T>(
    _orgId: string,
    _creditType: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Postmill BYOK model: Replicate media generation is unlimited and no longer
    // consumes platform credits. creditType is preserved in the job row for
    // observability only.
    return fn();
  }

  async runSync(
    orgId: string,
    userId: string,
    params: {
      modelId: string;
      input: Record<string, unknown>;
      operation: 'image' | 'stt';
    },
    opts?: { creditType?: string },
  ): Promise<RunSyncResult> {
    this._assertModelAllowed(params.modelId);
    return this._withCredit(orgId, opts?.creditType, async () => {
      const apiKey = await this._getApiKey(orgId);
      const resolvedInput = await this._resolveInputUrls(params.input, orgId);

      const pred = await this._pickCall(params.modelId, resolvedInput, apiKey, orgId, {
        wait: true,
        versionId: undefined,
      });

      if (params.operation === 'stt') {
        if (pred.status === 'succeeded') {
          const { text, segments } = this._normalizeSttOutput(pred.output);
          return { status: 'succeeded', kind: 'text', text, segments };
        }
        return {
          status: 'error',
          kind: 'text',
          error:
            'Audio too long for v1 sync transcription — use a shorter clip.',
        };
      }

      if (pred.status === 'succeeded') {
        const urls = this._normalizeUrls(pred.output);
        if (urls.length > 0) {
          return { status: 'succeeded', kind: 'image', urls };
        }
      }

      if (pred.status === 'failed' || pred.status === 'canceled') {
        throw new Error(pred.error || 'Generation failed');
      }

      if (!pred.id) {
        throw new Error('Replicate returned no prediction id');
      }

      const job = await this._aiSettings.createMediaJob({
        organizationId: orgId,
        // userId is an optional FK — an empty string would violate it, so coerce to undefined.
        userId: userId || undefined,
        provider: 'replicate',
        operation: 'image',
        status: 'pending',
        creditType: opts?.creditType,
        costUsd: estimate(params.modelId, resolvedInput).usd,
        model: params.modelId,
        inputJson: JSON.stringify(resolvedInput),
        artifactUrl: `pending://${pred.id}`,
      });

      return { status: 'pending', kind: 'image', jobId: job.id };
    });
  }

  async runAsync(
    orgId: string,
    userId: string,
    params: {
      modelId: string;
      versionId?: string;
      input: Record<string, unknown>;
      folderId?: string | null;
      operation: 'image' | 'video' | 'audio';
    },
    opts?: { creditType?: string },
  ): Promise<RunAsyncResult> {
    this._assertModelAllowed(params.modelId);
    return this._withCredit(orgId, opts?.creditType, async () => {
      const apiKey = await this._getApiKey(orgId);
      const resolvedInput = await this._resolveInputUrls(params.input, orgId);

      const job = await this._lifecycle.createPendingJob({
        organizationId: orgId,
        // userId is an optional FK — an empty string would violate it, so coerce to undefined.
        userId: userId || undefined,
        provider: 'replicate',
        operation: params.operation,
        model: params.modelId,
        // NO version here: the job row's version is the PROVIDER version (the
        // kernel resolves media/replicate@<version> with it when polling).
        // Storing params.versionId — the community MODEL hash — made such jobs
        // unresolvable ("Provider not found: media/replicate@8cf61ea…"). The
        // model hash rides only as a _pickCall dispatch option below.
        inputJson: JSON.stringify(resolvedInput),
        folderId: params.folderId,
        creditType: opts?.creditType,
        costUsd: estimate(params.modelId, resolvedInput).usd,
      });

      const webhook = this._lifecycle.webhookUrlFor(job.id, orgId);

      let pred: ReplicatePrediction;
      try {
        pred = await this._pickCall(params.modelId, resolvedInput, apiKey, orgId, {
          wait: false,
          webhookUrl: webhook || undefined,
          versionId: params.versionId,
        });
      } catch (err) {
        // The job row exists by now — a provider call that never returned a
        // prediction (billing rejection, upstream outage, timeout) must not
        // orphan it: without a `pending://` ref the poller skips it and it
        // would sit 'pending' until the 24h timeout while the frontend keeps
        // polling a job that can never resolve.
        const message = (err as Error)?.message || 'Replicate run failed';
        await this._lifecycle.failJob(job, message);
        throw err;
      }

      if (pred.status === 'failed' || pred.status === 'canceled' || !pred.id) {
        const errorMsg = pred.error || 'Replicate prediction failed without error';
        await this._lifecycle.failJob(job, errorMsg);
        throw new Error(errorMsg);
      }

      await this._lifecycle.attachProviderJob(job.id, pred.id, orgId);

      return { jobId: job.id };
    });
  }

  async getJob(orgId: string, jobId: string): Promise<GetJobResult> {
    const existing = await this._aiSettings.getMediaJobById(orgId, jobId);

    if (!existing || existing.organizationId !== orgId) {
      throw new ForbiddenException('Job not found');
    }

    // Drive completion by polling the provider so async jobs finish even when no
    // public webhook can reach this instance (local dev, private deploys). A
    // public-HTTPS deploy still completes faster via the webhook; processJob is a
    // no-op ('skipped') once the job is terminal, so the two paths don't conflict.
    if (existing.status === 'pending' || existing.status === 'processing') {
      try {
        await this._lifecycle.processJob(jobId);
      } catch {
        // Transient poll failure — leave the job pending for the next poll/sweep.
      }
    }

    const job = await this._aiSettings.getMediaJobById(orgId, jobId);
    if (!job || job.organizationId !== orgId) {
      throw new ForbiddenException('Job not found');
    }

    const kindMap: Record<string, 'image' | 'video' | 'audio'> = {
      image: 'image',
      video: 'video',
      audio: 'audio',
    };

    const kind = kindMap[job.operation as string] || 'image';
    const urls =
      job.status === 'completed' && job.artifactUrl ? [job.artifactUrl] : [];
    const file = urls.length
      ? await this._fileService.getFileByPath(orgId, urls[0]).catch(() => null)
      : null;
    const metadata = presentMediaMetadata(file?.metadata);

    return {
      status: job.status,
      result: job.status === 'completed'
        ? {
            kind,
            urls,
            fileId: file?.id ?? null,
            fileType: file?.type ?? null,
            metadata,
          }
        : null,
      error: job.error ?? null,
    };
  }

  async runMerge(
    orgId: string,
    userId: string,
    params: {
      clips: Array<{
        url?: string;
        fileId?: string;
        trimStart?: number;
        trimEnd?: number;
      }>;
      transitions: Array<{ type: string; duration?: number }>;
      folderId?: string | null;
    },
  ): Promise<{ jobId: string }> {
    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId,
      provider: 'replicate',
      operation: 'video',
      model: 'local/ffmpeg-merge',
      folderId: params.folderId,
      creditType: undefined,
      costUsd: 0,
    });

    // Resolve clips host-side into the job workdir (storage stays out of the render
    // container); the ffmpeg trim+xfade runs later in the queued/limited render worker.
    const workDir = renderWorkDir(job.id);
    await fs.promises.mkdir(workDir, { recursive: true });
    const { resolveClipsToFiles } = await import('./video-merge');

    try {
      await resolveClipsToFiles(
        params.clips,
        orgId,
        this._storage,
        (fileId) => this._resolveFileId(fileId, orgId),
        workDir,
      );
    } catch (err) {
      await this._lifecycle.failJob(job, (err as Error).message);
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }

    return this._videoRender.enqueueMerge(
      orgId,
      job,
      params.clips.map((c) => ({ trimStart: c.trimStart, trimEnd: c.trimEnd })),
      params.transitions,
      params.folderId,
    );
  }
}
