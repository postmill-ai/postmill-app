import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { RuntimeContextFactory } from '@gitroom/nestjs-libraries/providers/runtime-context.factory';
import { ProviderKernel, ProviderMetadata, AiCapability } from '@gitroom/provider-kernel';
import { MediaProviderAdapter } from '@gitroom/nestjs-libraries/media/media-provider-adapter.interface';
import {
  AI_MODEL_CATEGORIES,
  AI_MEDIA_CATEGORIES,
  AiMediaCategory,
  AiModelCategory,
} from './default-categories';

export interface ResolvedDefault {
  providerId: string;
  version: string;
  model?: string;
  settings?: Record<string, unknown>;
  source: 'stored' | 'auto';
}

interface CandidateProvider {
  providerId: string;
  version: string;
  metadata: ProviderMetadata;
}

@Injectable()
export class DefaultsResolutionService {
  private readonly _logger = new Logger(DefaultsResolutionService.name);

  constructor(
    private _repository: OrgDefaultModelRepository,
    @Inject(forwardRef(() => OrgAiSettingsService))
    private _orgAiSettings: OrgAiSettingsService,
    private _orgMediaSettings: OrgMediaProviderSettingsService,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    private _runtimeContextFactory: RuntimeContextFactory,
  ) {}

  async resolve(
    domain: 'ai' | 'media',
    category: string,
    orgId: string,
  ): Promise<ResolvedDefault | null> {
    const row = await this._repository.get(orgId, domain, category);
    const candidates = await this._candidates(domain, category, orgId);

    // 1) Stored row wins if the provider is still enabled and the stored model
    // still exists in the provider's catalog. The stored version is honored (v4
    // provider-framework pinning); if it is retired/unknown we fall back to the
    // latest active version and mark the default source: 'auto' so the UI can
    // prompt for re-selection.
    if (row) {
      const candidate = candidates.find((c) => c.providerId === row.providerId);
      if (candidate) {
        const storedVersion = row.version ?? candidate.version;
        let resolvedVersion = storedVersion;
        let source: ResolvedDefault['source'] = 'stored';

        const storedMod = this._kernel.get(domain, row.providerId, storedVersion);
        if (!storedMod || storedMod.manifest?.status === 'retired') {
          resolvedVersion =
            this._kernel.latestActive(domain, row.providerId)?.manifest.version ??
            candidate.version;
          source = 'auto';
        }

        const resolvedCandidate = { ...candidate, version: resolvedVersion };
        if (await this._modelExists(resolvedCandidate, row.model, category, orgId)) {
          return {
            providerId: row.providerId,
            version: resolvedVersion,
            model: row.model ?? undefined,
            settings: row.settings ? this._parseJson(row.settings) : undefined,
            source,
          };
        }
      }
    }

    // 2) Lazy auto-pick from the first candidate.
    const first = candidates[0];
    if (!first) {
      return null;
    }

    const model = await this._autoPickModel(first, category, orgId);
    return {
      providerId: first.providerId,
      version: first.version,
      model,
      source: 'auto',
    };
  }

  async resolveAll(
    domain: 'ai' | 'media',
    orgId: string,
  ): Promise<Record<string, ResolvedDefault>> {
    const categories = domain === 'ai' ? AI_MODEL_CATEGORIES : AI_MEDIA_CATEGORIES;
    const result: Record<string, ResolvedDefault> = {};
    for (const category of categories) {
      const resolved = await this.resolve(domain, category, orgId);
      if (resolved) {
        result[category] = resolved;
      }
    }
    return result;
  }

  async candidates(
    domain: 'ai' | 'media',
    category: string,
    orgId: string,
  ): Promise<CandidateProvider[]> {
    return this._candidates(domain, category, orgId);
  }

  private async _candidates(
    domain: 'ai' | 'media',
    category: string,
    orgId: string,
  ): Promise<CandidateProvider[]> {
    const candidateSet = new Map<string, CandidateProvider>();

    if (domain === 'ai') {
      const aiProviders = await this._orgAiSettings.getProviders(orgId);
      for (const p of aiProviders) {
        if (!p.enabled || !p.isConfigured) continue;
        const metadata = this._kernel.getMetadata('ai', p.identifier, p.version ?? 'v1');
        if (!metadata) continue;
        if (!metadata.domains.includes('ai')) continue;
        if (!metadata.modelCategories?.includes(category)) continue;
        candidateSet.set(p.identifier, {
          providerId: p.identifier,
          version: p.version ?? 'v1',
          metadata,
        });
      }
    } else {
      // Media candidates = union of enabled Media providers and enabled AI providers
      // whose metadata lists the media category. Primary media provider first.
      const mediaProviders = await this._orgMediaSettings.getProviders(orgId);
      const aiProviders = await this._orgAiSettings.getProviders(orgId);

      // Determine primary media provider (isActive + enabled + configured).
      const enabledMedia = mediaProviders.filter((p) => p.enabled && p.isConfigured);
      const primaryMedia = enabledMedia.find((p) => p.isActive) || enabledMedia[0];

      const addCandidate = (providerId: string, version: string, metadata: ProviderMetadata) => {
        if (candidateSet.has(providerId)) return;
        candidateSet.set(providerId, { providerId, version, metadata });
      };

      if (primaryMedia) {
        const metadata = this._kernel.getMetadata('media', primaryMedia.identifier, primaryMedia.version ?? 'v1');
        if (metadata && metadata.mediaCategories?.includes(category)) {
          addCandidate(primaryMedia.identifier, primaryMedia.version ?? 'v1', metadata);
        }
      }

      for (const p of enabledMedia) {
        if (p.identifier === primaryMedia?.identifier) continue;
        const metadata = this._kernel.getMetadata('media', p.identifier, p.version ?? 'v1');
        if (!metadata) continue;
        if (!metadata.mediaCategories?.includes(category)) continue;
        addCandidate(p.identifier, p.version ?? 'v1', metadata);
      }

      for (const p of aiProviders) {
        if (!p.enabled || !p.isConfigured) continue;
        const metadata = this._kernel.getMetadata('ai', p.identifier, p.version ?? 'v1');
        if (!metadata) continue;
        if (!metadata.domains.includes('media')) continue;
        if (!metadata.mediaCategories?.includes(category)) continue;
        addCandidate(p.identifier, p.version ?? 'v1', metadata);
      }
    }

    return Array.from(candidateSet.values());
  }

  private async _autoPickModel(
    candidate: CandidateProvider,
    category: string,
    orgId: string,
  ): Promise<string | undefined> {
    if (candidate.metadata.kind === 'action') {
      return undefined;
    }

    const models = await this._listModels(candidate, category, orgId);
    if (!models || models.length === 0) {
      return undefined;
    }

    const hints = candidate.metadata.modelHints?.[category];
    if (hints && hints.length > 0) {
      for (const hint of hints) {
        const match = models.find((m: { id: string }) => m.id.includes(hint));
        if (match) return match.id;
      }
    }

    return models[0].id;
  }

  private async _modelExists(
    candidate: CandidateProvider,
    model: string | null,
    category: string,
    orgId: string,
  ): Promise<boolean> {
    if (candidate.metadata.kind === 'action') {
      return true;
    }
    if (!model) {
      return false;
    }
    const models = await this._listModels(candidate, category, orgId);
    if (!models || models.length === 0) {
      // Cannot verify against the current catalog; conservatively keep the stored default
      // rather than discarding a user choice due to a transient listModels failure.
      return true;
    }
    return models.some((m: { id: string }) => m.id === model);
  }

  private _staticMediaModels(
    candidate: CandidateProvider,
    category: string,
  ): Array<{ id: string }> | undefined {
    const list = candidate.metadata.mediaModels?.[category];
    if (!Array.isArray(list) || list.length === 0) return undefined;
    return list.map((m) => ({ id: m.id }));
  }

  private async _listModels(
    candidate: CandidateProvider,
    category: string,
    orgId: string,
  ): Promise<Array<{ id: string }> | undefined> {
    // Resolve the capability to call listModels. AI providers expose listModels on the AI adapter;
    // media providers expose it on the media adapter. Use the org's actual credentials where
    // available so dynamic provider catalogs can be fetched authentically.
    try {
      const metadata = candidate.metadata;
      const isMediaCandidate = metadata.domains.includes('media') && metadata.mediaCategories?.includes(category);
      const domain = isMediaCandidate ? 'media' : 'ai';
      const credentials = await this._credentialsForCandidate(domain, candidate, orgId);
      const mod = this._kernel.get(domain, candidate.providerId, candidate.version);
      const ctx = this._runtimeContextFactory.build({ credentials, orgId });
      const capability = mod?.create(ctx);

      // 1.5: the two domains' listModels contracts differ — media takes
      // (operation, MediaCredentialOptions), AI takes the plain creds map. Type
      // each branch so the compiler enforces the signature (the previous
      // `any` cast passed the runtime CONTEXT where AI expected creds → apiKey
      // was undefined → placeholder catalog → wrong/dropped stored default).
      if (isMediaCandidate) {
        const media = capability as MediaProviderAdapter | undefined;
        if (!media?.listModels) {
          // No live catalog: fall back to the committed static model list.
          return this._staticMediaModels(candidate, category);
        }
        const live = await media.listModels(this._categoryToOperation(category), {
          credentials,
        });
        // A transient empty live catalog should not hide a static fallback.
        if (!live || live.length === 0) {
          return this._staticMediaModels(candidate, category) || live;
        }
        return live;
      }

      const ai = capability as Pick<AiCapability, 'listModels'> | undefined;
      if (!ai?.listModels) {
        return undefined;
      }
      return ai.listModels(credentials);
    } catch (err) {
      this._logger.warn(
        `listModels failed for ${candidate.providerId}@${candidate.version} category ${category}: ${(err as Error).message}`,
      );
      return this._staticMediaModels(candidate, category);
    }
  }

  private async _credentialsForCandidate(
    domain: 'ai' | 'media',
    candidate: CandidateProvider,
    orgId: string,
  ): Promise<Record<string, string>> {
    try {
      if (domain === 'ai') {
        const config = await this._orgAiSettings.getByIdentifier(orgId, candidate.providerId, candidate.version);
        return config?.credentials ?? {};
      }
      const config = await this._orgMediaSettings.getConfigForProvider(orgId, candidate.providerId, candidate.version);
      return config?.credentials ?? {};
    } catch {
      return {};
    }
  }

  private _categoryToOperation(category: string): 'image' | 'video' | 'audio' {
    // Simplified mapping for listModels calls. The full mapping lives in
    // default-categories.ts, but listModels only understands the kernel's
    // MediaOperation union ('image' | 'video' | 'audio').
    switch (category) {
      case 'text-to-image':
      case 'image-to-image':
      case 'image-upscale':
      case 'image-bg-remove':
      case 'image-inpaint':
      case 'image-slide':
      case 'image-focal-point':
        return 'image';
      case 'text-to-video':
      case 'image-to-video':
      case 'video-to-video':
      case 'video-background':
      case 'video-upscale':
      case 'video-avatar':
        return 'video';
      case 'text-to-music':
      case 'text-to-speech':
        return 'audio';
      // video-caption is speech-to-text (STT) → audio model catalog, not 'image'.
      case 'video-caption':
        return 'audio';
      default:
        return 'image';
    }
  }

  private _parseJson(value: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}
