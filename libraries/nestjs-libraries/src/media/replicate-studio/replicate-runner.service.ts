import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { ReplicateCatalogService } from './replicate-catalog.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { estimate } from './replicate-cost';
import { isWarm, MODEL_ALLOWLIST } from './replicate-catalog.allowlist';
import { VideoRenderService } from '@gitroom/nestjs-libraries/media/design-render/video-render.service';
import { renderWorkDir } from '@gitroom/nestjs-libraries/media/design-render/render-job-spec';
import * as fs from 'fs';

const BASE = 'https://api.replicate.com/v1';

interface ReplicatePrediction {
  id?: string;
  status?: string;
  output?: string | string[] | null;
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
  } | null;
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

  private async _pickCall(
    modelId: string,
    input: Record<string, unknown>,
    apiKey: string,
    orgId: string,
    opts: { wait?: boolean; webhookUrl?: string; versionId?: string },
  ): Promise<ReplicatePrediction> {
    const warm = isWarm(modelId);

    if (warm) {
      const res = await safeFetch(`${BASE}/models/${modelId}/predictions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(opts.wait ? { Prefer: `wait=60` } : {}),
        },
        body: JSON.stringify({
          input,
          ...(opts.webhookUrl
            ? { webhook: opts.webhookUrl, webhook_events_filter: ['completed'] }
            : {}),
        }),
      });
      if (!res.ok) throw new Error(`Replicate run failed: ${await res.text()}`);
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
        ...(opts.wait ? { Prefer: `wait=60` } : {}),
      },
      body: JSON.stringify({
        version: versionId,
        input,
        ...(opts.webhookUrl
          ? { webhook: opts.webhookUrl, webhook_events_filter: ['completed'] }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`Replicate run failed: ${await res.text()}`);
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
    output: string | string[] | null | undefined,
  ): string[] {
    if (!output) return [];
    if (Array.isArray(output))
      return output.filter((u): u is string => typeof u === 'string');
    return typeof output === 'string' ? [output] : [];
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
        version: params.versionId,
        inputJson: JSON.stringify(resolvedInput),
        folderId: params.folderId,
        creditType: opts?.creditType,
        costUsd: estimate(params.modelId, resolvedInput).usd,
      });

      const webhook = this._lifecycle.webhookUrlFor(job.id, orgId);

      const pred = await this._pickCall(params.modelId, resolvedInput, apiKey, orgId, {
        wait: false,
        webhookUrl: webhook || undefined,
        versionId: params.versionId,
      });

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

    return {
      status: job.status,
      result: job.status === 'completed' ? { kind, urls } : null,
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
