import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AIMediaJob } from '@prisma/client';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel } from '@gitroom/provider-kernel';
import { MediaGenerateOptions, MediaModelOption, MediaOperation } from '@gitroom/nestjs-libraries/media/media-provider-adapter.interface';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';
import { MEDIA_CATEGORY_OPERATION } from '@gitroom/nestjs-libraries/ai/defaults/default-categories';
import { mapWithConcurrency, singleFlight } from '@gitroom/nestjs-libraries/utils/concurrency';

// §3.3: cap the drive-on-read completion fan-out. Each processJob may download up to
// MAX_ARTIFACT_BYTES (512 MB) on completion; an unbounded Promise.all over ~30 pending
// jobs could run a dozen multi-hundred-MB downloads at once and OOM a 2 GB-heap backend.
const LISTJOBS_DRIVE_CONCURRENCY = 3;

export interface StudioGenerateParams {
  operation: 'video' | 'image' | 'audio';
  model?: string;
  input: Record<string, string | number | boolean>;
  mediaInputs?: Record<string, string>;
  folderId?: string | null;
  version?: string;
}

// Provider-agnostic studio backend. Every provider difference lives in its adapter +
// the frontend descriptor — this service only resolves credentials, creates the job
// ledger row, dispatches to the registry adapter by operation, and tracks completion
// through the shared MediaJobLifecycleService (webhook-first, poll-cron fallback).
@Injectable()
export class MediaStudioService {
  private readonly _logger = new Logger(MediaStudioService.name);

  constructor(
    private readonly _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    private readonly _lifecycle: MediaJobLifecycleService,
    private readonly _aiSettings: AiSettingsService,
    private readonly _resolution: ProviderResolutionService,
    @Inject(PROVIDER_KERNEL) private readonly _kernel: ProviderKernel,
    private readonly _storage: StorageService,
    private readonly _fileService: FileService,
    private readonly _redis: RedisService,
  ) {}

  // Runtime model catalog for a modality, feeding the studio's dynamic model dropdown.
  // Cached ~60s per (provider, operation, org) — catalogs are large but change rarely, and
  // every render's status poll must not re-hit the provider's /models endpoint. Returns []
  // when the adapter exposes no catalog (the descriptor's static options then apply).
  async listModels(orgId: string, provider: string, operation: MediaOperation, version?: string): Promise<MediaModelOption[]> {
    const cacheKey = `studio:models:${provider}:${operation}:${orgId}:${version ?? 'default'}`;
    const cached = await this._redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as MediaModelOption[];
      } catch {
        /* fall through to refetch */
      }
    }

    // 1.7: a provider the org has explicitly disabled (or an unconfigured
    // universal provider) exposes no model catalog.
    if (!(await this._orgMediaProviderSettings.isProviderEnabledForOperation(orgId, provider, operation))) {
      return [];
    }

    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, provider, version);
    if (!config?.credentials || Object.keys(config.credentials).length === 0) return [];

    const adapter = this._resolution.resolveMedia(provider, {
      version: config.version,
      credentials: config.credentials,
      orgId,
    });

    let models: MediaModelOption[] = [];
    if (adapter?.listModels) {
      try {
        models = await adapter.listModels(operation, { credentials: config.credentials });
      } catch (err) {
        this._logger.warn(`listModels failed for ${provider}/${operation}: ${(err as Error).message}`);
      }
    }

    // Fallback to the committed static catalog for providers that have no live
    // listModels or whose live catalog came back empty.
    if (models.length === 0) {
      const staticModels = this._staticModelsForOperation(provider, config.version, operation);
      if (staticModels.length > 0) {
        models = staticModels;
      }
    }

    if (models.length > 0) {
      await this._redis.set(cacheKey, JSON.stringify(models), 60).catch(() => {});
    }
    return models;
  }

  private _staticModelsForOperation(
    provider: string,
    version: string,
    operation: MediaOperation,
  ): MediaModelOption[] {
    const metadata = this._kernel.getMetadata('media', provider, version);
    if (!metadata?.mediaModels) return [];

    const categories = Object.keys(MEDIA_CATEGORY_OPERATION).filter(
      (cat) => MEDIA_CATEGORY_OPERATION[cat as keyof typeof MEDIA_CATEGORY_OPERATION] === operation,
    );

    const seen = new Set<string>();
    const out: MediaModelOption[] = [];
    for (const category of categories) {
      const list = metadata.mediaModels[category];
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ id: m.id, label: m.label || m.id });
      }
    }
    return out;
  }

  async getStatus(orgId: string, provider: string, _version?: string): Promise<{ configured: boolean; enabled: boolean }> {
    const providers = await this._orgMediaProviderSettings.getProviders(orgId);
    const match = providers.find((p) => p.identifier === provider);
    if (!match) throw new ForbiddenException(`Unknown media provider "${provider}"`);
    return { configured: match.isConfigured, enabled: match.enabled };
  }

  async generate(
    orgId: string,
    userId: string,
    provider: string,
    params: StudioGenerateParams,
  ): Promise<{ jobId: string }> {
    // 1.7: block a provider the org has disabled (explicit `enabled:false` row) —
    // including the universal-credential providers whose AI-key fallback would
    // otherwise keep billing after the org disabled media to stop spend.
    if (!(await this._orgMediaProviderSettings.isProviderEnabledForOperation(orgId, provider, params.operation))) {
      throw new ForbiddenException(`${provider} is disabled for this organization. Enable it in Settings → Media.`);
    }

    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, provider, params.version);
    const credentials = config?.credentials;
    if (!credentials || Object.keys(credentials).length === 0) {
      throw new ForbiddenException(`${provider} is not configured. Add credentials in Settings → Media.`);
    }

    const adapter = this._resolution.resolveMedia(provider, {
      version: config.version,
      credentials,
      orgId,
    });

    // Resolve media-field file references to provider-reachable URLs (server-side, so
    // local-storage assets get a usable URL rather than an internal /files path).
    const input: Record<string, string | number | boolean> = { ...params.input };
    if (params.mediaInputs) {
      for (const [field, fileId] of Object.entries(params.mediaInputs)) {
        if (fileId) input[field] = await this._resolvePublicUrl(orgId, fileId);
      }
    }

    const { prompt, model: inputModel, ...rest } = input;
    const model = params.model || (typeof inputModel === 'string' ? inputModel : undefined);
    const promptStr = typeof prompt === 'string' ? prompt : '';

    const job = await this._lifecycle.createPendingJob({
      organizationId: orgId,
      userId: userId || undefined,
      provider,
      operation: params.operation,
      model: model ?? provider,
      version: config.version,
      folderId: params.folderId,
      inputJson: JSON.stringify({ operation: params.operation, model, prompt: promptStr, input: rest }),
    });

    const webhookUrl = this._lifecycle.webhookUrlFor(job.id, orgId);
    const options: MediaGenerateOptions = {
      credentials,
      webhookUrl,
      model,
      input: rest,
    };

    try {
      if (params.operation === 'image') {
        const result = await adapter.generateImage(promptStr, options);
        const url = result.image || result.images?.[0];
        if (!url) throw new Error('Provider returned no image');
        const ok = await this._lifecycle.completeJob(job, url, result.metadata, job.folderId);
        if (!ok) throw new Error('Failed to store generated image');
        return { jobId: job.id };
      }

      const submit =
        params.operation === 'audio'
          ? await adapter.generateAudio(promptStr, options)
          : await adapter.generateVideo(promptStr, options);

      // Sync providers return the finished artifact inline — complete immediately.
      if (submit.artifactUrl) {
        const ok = await this._lifecycle.completeJob(job, submit.artifactUrl, submit.metadata, job.folderId);
        if (!ok) throw new Error('Failed to store generated artifact');
        return { jobId: job.id };
      }

      await this._lifecycle.attachProviderJob(job.id, submit.jobId, orgId);
      return { jobId: job.id };
    } catch (err) {
      await this._lifecycle.failJob(job, (err as Error).message, { notify: false });
      throw err;
    }
  }

  // Lists recent jobs for the render queue. Drives completion on read so the queue
  // advances even where no public webhook can reach this instance (local dev / private
  // deploys); the media-jobs-poll cron is the backstop.
  async listJobs(orgId: string, provider: string, _version?: string, limit = 30) {
    const pending = await this._aiSettings.getMediaJobsByProvider(orgId, provider, limit);
    const drivable = pending.filter((j) => j.status === 'pending' || j.status === 'processing');
    // §3.3: bound the fan-out and singleFlight per job id so a concurrent webhook/cron
    // sweep and this read don't both drive (and both download) the same job at once.
    await mapWithConcurrency(drivable, LISTJOBS_DRIVE_CONCURRENCY, (j) =>
      singleFlight(`media-job:${j.id}`, () => this._lifecycle.processJob(j.id)).catch(() => undefined),
    );
    const jobs = await this._aiSettings.getMediaJobsByProvider(orgId, provider, limit);
    // M-03: batch-resolve File rows for all completed jobs in a single findMany,
    // then map back to jobs, eliminating the N+1 query in _presentJob.
    const fileMap = await this._resolveFileMap(orgId, jobs);
    return jobs.map((j) => this._presentJob(j, fileMap));
  }

  private async _resolveFileMap(orgId: string, jobs: AIMediaJob[]): Promise<Map<string, { id: string }>> {
    const completedPaths = jobs
      .filter((j) => j.status === 'completed' && j.artifactUrl)
      .map((j) => j.artifactUrl!);
    if (completedPaths.length === 0) return new Map<string, { id: string }>();
    const files = (await this._fileService
      .getFilesByPaths(orgId, completedPaths)
      .catch(() => [])) as Array<{ path: string; id: string }>;
    return new Map(files.map((f) => [f.path, f]));
  }

  private _presentJob(job: AIMediaJob, fileMap: Map<string, { id: string }>) {
    // The pending `pending://` ref is internal and must never reach the client; only a
    // completed job has a real /files URL. Resolve the File id too so the composer
    // handoff ("Post") can attach it.
    const completed = job.status === 'completed' && job.artifactUrl;
    const fileId = completed ? fileMap.get(job.artifactUrl!)?.id ?? null : null;
    return {
      id: job.id,
      operation: job.operation,
      status: job.status,
      artifactUrl: completed ? job.artifactUrl : null,
      fileId,
      error: job.error || null,
      createdAt: job.createdAt,
    };
  }

  // Resolve a /files asset to a URL the provider can fetch (cloud → public URL, local →
  // media-directory URL). Mirrors the HeyGen/Replicate resolvers.
  private async _resolvePublicUrl(orgId: string, fileId: string): Promise<string> {
    const file = await this._fileService.getFileById(orgId, fileId);
    if (!file) {
      throw new ForbiddenException('File not found');
    }
    if (file.path.startsWith('https://')) return file.path;
    const adapter = file.folderId
      ? await this._storage.resolveAdapterForFolder(file.folderId, orgId)
      : await this._storage.getLocalAdapterForOrg(orgId, true);
    return adapter.getFileUrl(file.path);
  }
}
