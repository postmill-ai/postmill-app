import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DefaultsResolutionService } from './defaults-resolution.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import {
  DefaultNotConfiguredError,
  DefaultOperationNotImplementedError,
} from './defaults.errors';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { DefaultsSettingsValidator } from './defaults-settings.validator';
import { AI_MODEL_CATEGORIES } from './default-categories';
import { SetDefaultModelDto } from '@gitroom/nestjs-libraries/dtos/ai-settings/default-model.dto';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { bustDefaultsCatalogCache } from './defaults-cache';
import { AIProviderAdapter } from '@gitroom/nestjs-libraries/ai/ai-provider.interface';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel, DEFAULT_VERSION } from '@gitroom/provider-kernel';
import { ProviderConfigDto } from '@gitroom/nestjs-libraries/types/provider-config.types';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

export { DefaultNotConfiguredError, DefaultOperationNotImplementedError };

export type ProviderConfigSummary = Pick<
  ProviderConfigDto,
  'identifier' | 'name' | 'enabled' | 'isActive' | 'version'
>;

@Injectable()
export class AiDefaultsService {
  constructor(
    private _resolution: DefaultsResolutionService,
    private _aiModelProvider: AIModelProvider,
    private _aiMediaService: AiMediaService,
    private _defaultsRepository: OrgDefaultModelRepository,
    private _settingsValidator: DefaultsSettingsValidator,
    private _providerResolution: ProviderResolutionService,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    @Inject(forwardRef(() => OrgAiSettingsService))
    private _orgAiSettings: OrgAiSettingsService,
  ) {}

  // ── Provider catalog ───────────────────────────────────────────────────────

  // Resolve a single AI adapter through the ProviderKernel; undefined for an
  // unknown/unregistered provider (mirrors the old registry.getAdapter).
  resolveAdapter(identifier: string, version?: string): AIProviderAdapter | undefined {
    try {
      return this._providerResolution.resolveAI(identifier, version ? { version } : {});
    } catch {
      return undefined;
    }
  }

  // Enumerate the registered AI adapters (one per provider id) — replaces the
  // legacy in-memory registry enumeration.
  private _listAdapters(): AIProviderAdapter[] {
    const seen = new Set<string>();
    const out: AIProviderAdapter[] = [];
    for (const manifest of this._kernel?.listManifests('ai') ?? []) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      const adapter = this.resolveAdapter(manifest.providerId, manifest.version);
      if (adapter) out.push(adapter);
    }
    return out;
  }

  private _aiVersionMeta(identifier: string) {
    const manifests = this._kernel?.versions('ai', identifier) ?? [];
    const latestActive = this._kernel?.latestActive('ai', identifier)?.manifest;
    const version = latestActive?.version ?? manifests[0]?.version ?? DEFAULT_VERSION;
    const status = latestActive?.status ?? manifests[0]?.status ?? 'active';
    const availableVersions = manifests.map((m) => ({
      version: m.version,
      status: m.status,
      credentialFields: m.credentialFields,
    }));
    return {
      version,
      status,
      availableVersions,
      credentialFields: latestActive?.credentialFields ?? manifests[0]?.credentialFields,
    };
  }

  async listProviders() {
    const adapters = this._listAdapters();
    return adapters.map((adapter) => {
      const meta = this._aiVersionMeta(adapter.identifier);
      return {
        identifier: adapter.identifier,
        name: adapter.name,
        type: adapter.type,
        capabilities: adapter.capabilities,
        privacy: adapter.privacy,
        credentialFields: meta.credentialFields ?? adapter.credentialFields,
        ...meta,
      };
    });
  }

  async getProviderConfigSummary(orgId: string): Promise<{
    active: ProviderConfigSummary | null;
    providers: ProviderConfigSummary[];
  }> {
    const active = await this._orgAiSettings.getActiveProvider(orgId);
    const allConfigs = await this._orgAiSettings.getProviders(orgId);
    // Never ship decrypted provider credentials to the client (#53). The active
    // provider's credentials stay server-side for model resolution only.
    const safeActive = active
      ? (({ credentials, ...rest }) => ({ ...rest, ...this._aiVersionMeta(rest.identifier) }))(active as any)
      : null;
    return {
      active: safeActive,
      providers: allConfigs.map((p: any) => ({ ...p, ...this._aiVersionMeta(p.identifier) })),
    };
  }

  // ── Model Defaults (per-org AI model defaults) ─────────────────────────────

  async getModelDefaults(orgId: string) {
    const resolved = await this._resolution.resolveAll('ai', orgId);
    const stored = await this._defaultsRepository.getAll(orgId, 'ai');
    return {
      categories: AI_MODEL_CATEGORIES.map((category) => {
        const r = resolved[category];
        const s = stored.find((row) => row.category === category);
        return {
          category,
          ...(r || {}),
          source: s ? 'stored' : (r ? 'auto' : null),
        };
      }),
    };
  }

  async setModelDefault(orgId: string, category: string, body: SetDefaultModelDto) {
    const safeCategory = AI_MODEL_CATEGORIES.find((c) => c === category);
    if (!safeCategory) {
      throw new BadRequestException(`Invalid model category: ${category}`);
    }
    const cleaned = this._sanitizeSettings('ai', safeCategory, body);
    await this._defaultsRepository.upsert(orgId, 'ai', safeCategory, cleaned);
    this.bustDefaultsCatalogCache(orgId);
    return { category: safeCategory, success: true };
  }

  async clearModelDefault(orgId: string, category: string) {
    const safeCategory = AI_MODEL_CATEGORIES.find((c) => c === category);
    if (!safeCategory) {
      throw new BadRequestException(`Invalid model category: ${category}`);
    }
    await this._defaultsRepository.remove(orgId, 'ai', safeCategory);
    return { category: safeCategory, success: true };
  }

  async getModelDefaultsCatalog(orgId: string, category: string) {
    const safeCategory = AI_MODEL_CATEGORIES.find((c) => c === category);
    if (!safeCategory) {
      throw new BadRequestException(`Invalid model category: ${category}`);
    }
    const cacheKey = `settings:ai:defaults:catalog:${orgId}:${safeCategory}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const candidates = await this._resolution.candidates('ai', safeCategory, orgId);
    const options: { providerId: string; version: string; model?: string; label: string }[] = [];
    for (const c of candidates) {
      const providerLabel = this._providerLabel(c);
      if (!c.metadata.hasModelList || c.metadata.kind === 'action') {
        options.push({
          providerId: c.providerId,
          version: c.version,
          label: providerLabel,
        });
      } else {
        const models = await this._listModelsForCandidate(c, safeCategory, orgId);
        if (models.length === 0) {
          // Configured model-list provider whose catalog couldn't be enumerated
          // (transient API failure / empty list). Still offer a provider-level option
          // (no model) so a working provider stays selectable — mirrors the resolver's
          // undefined-model auto-pick. Without this, removing free-text entry would make
          // the default un-settable. After this fix, "catalog empty" ⇔ "no candidate".
          options.push({
            providerId: c.providerId,
            version: c.version,
            label: providerLabel,
          });
        }
        for (const m of models) {
          options.push({
            providerId: c.providerId,
            version: c.version,
            model: m.id,
            label: `${providerLabel}: ${m.label || m.id}`,
          });
        }
      }
    }
    const result = { category: safeCategory, options };
    await ioRedis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    return result;
  }

  private _sanitizeSettings(
    domain: 'ai' | 'media',
    category: string,
    body: SetDefaultModelDto,
  ): SetDefaultModelDto {
    if (!body.settings || typeof body.settings !== 'object') return body;
    const cleaned = this._settingsValidator.validate(domain, category, body.settings, {
      providerId: body.providerId,
      model: body.model,
    });
    return { ...body, settings: cleaned };
  }

  bustDefaultsCatalogCache(orgId: string): void {
    // Delegated to a standalone helper so OrgAiSettingsService can bust the
    // cache without creating a dependency-injection cycle with this service.
    bustDefaultsCatalogCache(orgId);
  }

  private _providerLabel(candidate: { providerId: string; metadata: { uiName?: string } }): string {
    return candidate.metadata.uiName
      ? `${candidate.providerId}-${candidate.metadata.uiName}`
      : candidate.providerId;
  }

  private async _listModelsForCandidate(
    candidate: { providerId: string; version: string; metadata: any },
    category: string,
    orgId: string,
  ) {
    try {
      const config = await this._orgAiSettings.getByIdentifier(orgId, candidate.providerId, candidate.version);
      const credentials = config?.credentials ?? {};
      const mod = this._kernel?.get('ai', candidate.providerId, candidate.version);
      const capability: any = mod?.create({
        credentials,
        encryption: {} as any,
        fetch: {} as any,
        logger: {} as any,
        telemetry: {} as any,
      });
      if (!capability?.listModels) return [];
      const models = await capability.listModels(credentials);
      return this._filterModelsByCategory(models || [], category);
    } catch {
      return [];
    }
  }

  private _filterModelsByCategory(models: any[], category: string): any[] {
    switch (category) {
      case 'vision':
        return models.filter((m) => m.capabilities?.vision);
      case 'high-reasoning':
        return models.filter((m) => m.reasoning || m.capabilities?.text);
      case 'workflow':
      case 'low-reasoning':
      default:
        return models.filter((m) => m.capabilities?.text);
    }
  }

  // ── Text utilities ─────────────────────────────────────────────────────────

  async lowReasoningText(orgId: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) {
    return this._textForCategory('low-reasoning', orgId, prompt, opts);
  }

  async highReasoningText(orgId: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) {
    return this._textForCategory('high-reasoning', orgId, prompt, opts);
  }

  async workflow(
    orgId: string,
    messages: Array<{ role: string; content: string }>,
    opts?: { temperature?: number; maxTokens?: number; [key: string]: unknown },
  ) {
    const resolved = await this._require('ai', 'workflow', orgId);
    return this._aiModelProvider.generateTextWithModel(
      orgId,
      resolved.providerId,
      resolved.version,
      resolved.model,
      { messages, ...opts },
    );
  }

  async vision(orgId: string, imageUrl: string, prompt: string) {
    const resolved = await this._require('ai', 'vision', orgId);
    return this._aiModelProvider.generateTextWithModel(
      orgId,
      resolved.providerId,
      resolved.version,
      resolved.model,
      { imageUrl, prompt },
    );
  }

  async altText(orgId: string, imageUrl: string): Promise<{ altText: string }> {
    const resolved = await this._require('ai', 'vision', orgId);
    const altText = await this._aiModelProvider.generateTextWithModel(
      orgId,
      resolved.providerId,
      resolved.version,
      resolved.model,
      {
        imageUrl,
        prompt:
          'Describe this image in one concise sentence suitable as alt text. Return only the description, no markdown or explanation.',
      },
    );
    return { altText };
  }

  private async _textForCategory(
    category: 'low-reasoning' | 'high-reasoning',
    orgId: string,
    prompt: string,
    opts?: { temperature?: number; maxTokens?: number },
  ) {
    const resolved = await this._require('ai', category, orgId);
    return this._aiModelProvider.generateTextWithModel(
      orgId,
      resolved.providerId,
      resolved.version,
      resolved.model,
      { prompt, ...opts },
    );
  }

  // ── Media utilities (implemented) ──────────────────────────────────────────
  //
  // F-3: every media utility first resolves the org's configured media default for
  // its category and throws the typed `DefaultNotConfiguredError` (→ 409) when none
  // exists, BEFORE delegating to `AiMediaService`. Without this guard the delegation
  // would silently fall back to ANY capability-matching provider and surface a generic
  // `CapabilityNotAvailable` instead of the plan's typed "no default configured" error.
  // The success path (a default IS configured) is unchanged — `AiMediaService` still
  // re-resolves internally for the actual provider/model.

  async textToImage(orgId: string, prompt: string) {
    await this._requireMedia(orgId, 'text-to-image');
    return this._aiMediaService.generateImage(prompt, { orgId });
  }

  async textToVideo(orgId: string, prompt: string) {
    await this._requireMedia(orgId, 'text-to-video');
    return this._aiMediaService.generateVideo(prompt, { orgId });
  }

  async textToSpeech(orgId: string, text: string, opts?: { voice?: string }) {
    await this._requireMedia(orgId, 'text-to-speech');
    return this._aiMediaService.textToSpeech(text, { orgId, voice: opts?.voice });
  }

  async textToMusic(orgId: string, prompt: string) {
    await this._requireMedia(orgId, 'text-to-music');
    return this._aiMediaService.generateAudio(prompt, { orgId });
  }

  async imageUpscale(orgId: string, imageUrl: string) {
    await this._requireMedia(orgId, 'image-upscale');
    return this._aiMediaService.upscaleImage(imageUrl, { orgId });
  }

  async imageBgRemove(orgId: string, imageUrl: string) {
    await this._requireMedia(orgId, 'image-bg-remove');
    return this._aiMediaService.removeBackground(imageUrl, { orgId });
  }

  async imageInpaint(orgId: string, imageUrl: string, maskUrl: string, prompt: string) {
    await this._requireMedia(orgId, 'image-inpaint');
    return this._aiMediaService.inpaintImage(imageUrl, maskUrl, prompt, { orgId });
  }

  async imageFocalPoint(orgId: string, imageUrl: string) {
    // Focal-point detection uses the AI vision default, not a media default.
    await this._require('ai', 'vision', orgId);
    return this._aiMediaService.detectFocalPoint(imageUrl, { orgId });
  }

  // ── Media utilities (pending new pipelines) ─────────────────────────────────

  async imageToImage(orgId: string, prompt: string, imageUrl: string) {
    await this._requireMedia(orgId, 'image-to-image');
    return this._aiMediaService.generateImage(prompt, { orgId, sourceUrl: imageUrl });
  }

  async imageToVideo(orgId: string, prompt: string, imageUrl: string) {
    await this._requireMedia(orgId, 'image-to-video');
    return this._aiMediaService.generateVideo(prompt, { orgId, sourceUrl: imageUrl });
  }

  async videoToVideo(orgId: string, prompt: string, videoUrl: string) {
    await this._requireMedia(orgId, 'video-to-video');
    return this._aiMediaService.generateVideo(prompt, {
      orgId,
      sourceUrl: videoUrl,
      category: 'video-to-video',
    });
  }

  async imageSlide(orgId: string, prompt: string, imageUrls?: string[]) {
    await this._requireMedia(orgId, 'image-slide');
    return this._aiMediaService.generateSlide(orgId, prompt, imageUrls);
  }

  async videoAvatar(orgId: string, script: string, opts?: { imageUrl?: string; avatarId?: string }) {
    await this._requireMedia(orgId, 'video-avatar');
    return this._aiMediaService.generateAvatar(script, { orgId, sourceUrl: opts?.imageUrl });
  }

  async videoCaption(orgId: string, videoUrl: string) {
    await this._requireMedia(orgId, 'video-caption');
    return this._aiMediaService.captionVideo(orgId, videoUrl);
  }

  async videoBackground(orgId: string, videoUrl: string, _opts?: { background?: string }) {
    await this._requireMedia(orgId, 'video-background');
    return this._aiMediaService.removeVideoBackground(videoUrl, { orgId });
  }

  async videoUpscale(orgId: string, videoUrl: string) {
    await this._requireMedia(orgId, 'video-upscale');
    return this._aiMediaService.upscaleVideo(videoUrl, { orgId });
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private async _requireMedia(orgId: string, category: string) {
    return this._require('media', category, orgId);
  }

  private async _require(domain: 'ai' | 'media', category: string, orgId: string) {
    const resolved = await this._resolution.resolve(domain, category, orgId);
    if (!resolved) {
      throw new DefaultNotConfiguredError(category);
    }
    return resolved;
  }
}
