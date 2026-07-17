import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'crypto';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { DefaultsResolutionService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { OrgAiSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { MediaJobLifecycleService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/media-job-lifecycle.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { BudgetService } from './budget.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
  MediaGenerationResult,
} from '@gitroom/nestjs-libraries/media/media-provider-adapter.interface';
// Type-only imports: SlideService/CaptionService both inject back into this AI module
// (slide -> AiDefaultsService -> AiMediaService; caption -> AiMediaService), so a runtime
// value-import here closes a circular `require` that leaves AiMediaService `undefined` at
// decorator-metadata time (boot-time DI failure). They are only ever resolved lazily via
// `moduleRef.get(...)` at call-time, so the runtime class is `require`d inside the methods.
import type { SlideService } from '@gitroom/nestjs-libraries/media/slide/slide.service';
import type { CaptionService } from '@gitroom/nestjs-libraries/media/caption/caption.service';
import { CapabilityNotAvailable } from './errors';
import type { MediaOperation } from '@gitroom/nestjs-libraries/ai/governance/media-operation.types';
import {
  AI_MEDIA_CATEGORIES,
  MEDIA_CATEGORY_OPERATION,
  type AiMediaCategory,
} from '@gitroom/nestjs-libraries/ai/defaults/default-categories';

// Read-only, credential-free view of which media providers are active per operation.
// Surfaced to non-admin users (4F) so they can see what media capabilities the org
// has configured without exposing any provider secrets.
export interface MediaProviderSummaryEntry {
  operation: MediaOperation;
  available: boolean;
  providers: { id: string; enabled: boolean; c2paAvailable: boolean }[];
}

// Single, honest "can this media tool run?" signal — keyed off the SAME predicate the
// generation path uses (`_resolveForOperation`, incl. the image AI-fallback), so the
// Settings disable-state, the composer/Designer gating, and the actual generate endpoints
// can never disagree. `operations` is the authoritative availability (what consumers gate
// on); `tools` projects it onto the 16 user-facing categories with best-effort
// provider/model detail for display.
export interface MediaToolStatusEntry {
  available: boolean;
  provider?: string;
  version?: string;
  model?: string;
  reason?: string;
}
export interface MediaToolStatus {
  operations: Record<MediaOperation, { available: boolean; provider?: string }>;
  tools: Record<AiMediaCategory, MediaToolStatusEntry>;
}

const ALL_MEDIA_OPERATIONS: MediaOperation[] = [
  'image',
  'video',
  'audio',
  'avatar',
  'tts',
  'stt',
  'upscale',
  'bg-remove',
  'inpaint',
  'focal-point',
  'slide',
  'caption',
  'video-bg',
  'video-upscale',
];

// Capability-driven resolution (§11.2): each media operation maps onto the adapter
// capability flag that declares support for it.
const OPERATION_CAPABILITY: Record<MediaOperation, keyof MediaProviderCapabilities> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  avatar: 'avatar',
  tts: 'tts',
  stt: 'stt',
  upscale: 'upscale',
  'bg-remove': 'bgRemove',
  inpaint: 'inpaint',
  'focal-point': 'image',
  slide: 'image',
  caption: 'stt',
  'video-bg': 'videoBg',
  'video-upscale': 'videoUpscale',
};

// Postmill BYOK model: AI media generation is unlimited and no longer consumes
// legacy ai_images / ai_videos credits. creditType is kept as a nullable column
// for observability but is always undefined for new jobs.
const OPERATION_CREDIT_TYPE: Record<MediaOperation, undefined> = {
  image: undefined,
  upscale: undefined,
  'bg-remove': undefined,
  inpaint: undefined,
  video: undefined,
  avatar: undefined,
  audio: undefined,
  tts: undefined,
  stt: undefined,
  'focal-point': undefined,
  slide: undefined,
  caption: undefined,
  'video-bg': undefined,
  'video-upscale': undefined,
};

// Rough default per-operation USD cost. The @reaatech/media-pipeline-mcp-cost ledger
// records the `usd` it is given (it carries no pricing table), so the facade supplies
// these estimates. They populate AIMediaJob.costUsd and feed the §6 budget view as the
// $-denominated layer on top of the count-based credit allowance (§6.4).
const OPERATION_COST_USD: Record<MediaOperation, number> = {
  image: 0.04,
  video: 0.5,
  audio: 0.1,
  avatar: 0.5,
  upscale: 0.01,
  'bg-remove': 0.01,
  inpaint: 0.02,
  tts: 0.015,
  stt: 0.01,
  'focal-point': 0.005,
  slide: 0.5,
  caption: 0.05,
  'video-bg': 0.5,
  'video-upscale': 0.5,
};

// Operations whose output is freshly generated/edited visual media — eligible for
// C2PA provenance signing (§3.5.20). TTS/STT audio + transcription are excluded.
const PROVENANCE_OPERATIONS = new Set<MediaOperation>([
  'image',
  'video',
  'avatar',
  'upscale',
  'inpaint',
  'bg-remove',
  'slide',
  'caption',
  'video-bg',
  'video-upscale',
]);

interface ProvenanceSettings {
  enabled?: boolean;
  signingKey?: unknown;
  signGenerativeOnly?: boolean;
  embedMode?: 'in-file' | 'sidecar' | 'both';
}

interface CostLedgerLike {
  charge(entry: {
    id: string;
    runId: string;
    tenantId?: string;
    stepId: string;
    provider: string;
    operation: string;
    modelId: string;
    inputUnits: number;
    outputUnits: number;
    inputUnitType: string;
    outputUnitType: string;
    usd: number;
    at: string;
  }): Promise<unknown>;
}

interface ProvenanceSignerLike {
  sign(
    artifactUrl: string,
    manifest: {
      title: string;
      format: string;
      claimGenerator: string;
      pipelineDefHash: string;
      runId: string;
      generatedAt: string;
      assertions: unknown[];
    },
  ): Promise<{ manifestUri?: string } | undefined>;
}

interface ResolvedMediaProvider {
  adapter: MediaProviderAdapter;
  credentials: Record<string, string>;
  version: string;
}

type AsyncOperation = 'video' | 'audio' | 'avatar';

@Injectable()
export class AiMediaService {
  private _logger = new Logger(AiMediaService.name);

  constructor(
    private _aiSettings: AiSettingsService,
    private _aiModelProvider: AIModelProvider,
    private _aiSettingsManager: AiSettingsManager,
    private _resolution: ProviderResolutionService,
    @Optional() private _defaultsResolution?: DefaultsResolutionService,
    @Optional() private _orgMediaProviderSettings?: OrgMediaProviderSettingsService,
    @Optional() private _lifecycle?: MediaJobLifecycleService,
    // layering: sanctioned leaf-read of OrgAiSettingsRepository.
    // OrgAiSettingsService imports ProviderCredentialLinkService from the media-providers
    // package, so routing this universal-credential fallback "up" through the AI service
    // would create a Nest DI cycle. The read is credential-decryption only, behaviour-neutral.
    @Optional() private _orgAiSettingsRepository?: OrgAiSettingsRepository,
    @Optional() private _encryptionService?: EncryptionService,
    @Optional() private _moduleRef?: ModuleRef,
    @Optional() private _budget?: BudgetService,
    @Optional() private _storageService?: StorageService,
    @Optional() private _fileService?: FileService,
    @Optional() private _brandsService?: BrandsService,
  ) {}

  async getJob(id: string, orgId: string) {
    return this._lifecycle?.getJob(id, orgId) ?? null;
  }

  // Resolve a media adapter through the ProviderKernel; returns null for an
  // unknown/unregistered provider (mirrors the old registry.get semantics).
  private _resolveMediaAdapter(
    identifier: string,
    options: { version?: string; credentials?: Record<string, string>; orgId?: string } = {},
  ): MediaProviderAdapter | null {
    try {
      return this._resolution.resolveMedia(identifier, options);
    } catch {
      return null;
    }
  }

  // Map a runtime media operation onto the default-model categories that can
  // satisfy it. `sourceUrl` hints at image-to-image / image-to-video variants.
  private _defaultCategoriesForOperation(
    operation: MediaOperation,
    sourceUrl?: string,
  ): string[] {
    switch (operation) {
      case 'image':
        return sourceUrl ? ['image-to-image'] : ['text-to-image'];
      case 'video':
        return sourceUrl ? ['image-to-video', 'video-to-video'] : ['text-to-video'];
      case 'audio':
        return ['text-to-music'];
      case 'tts':
        return ['text-to-speech'];
      case 'stt':
        return ['video-caption'];
      case 'upscale':
        return ['image-upscale'];
      case 'bg-remove':
        return ['image-bg-remove'];
      case 'inpaint':
        return ['image-inpaint'];
      case 'avatar':
        return ['video-avatar'];
      case 'video-bg':
        return ['video-background'];
      case 'video-upscale':
        return ['video-upscale'];
      default:
        return [];
    }
  }

  // Resolve the org's configured default for a media operation, if any.
  // Falls back to the org's AI provider credentials when the default is an
  // AI-registered media adapter without a dedicated MediaProviderConfig row.
  // When the caller passes an explicit `category` (e.g. 'video-to-video'),
  // resolve that category directly instead of falling through the operation-based
  // category list. This prevents a configured video-to-video default from being
  // shadowed by an image-to-video default when the source is a video.
  private async _resolveDefaultForOperation(
    operation: MediaOperation,
    orgId?: string,
    sourceUrl?: string,
    category?: string,
  ): Promise<ResolvedMediaProvider | null> {
    if (!orgId || !this._defaultsResolution || !this._orgMediaProviderSettings) {
      return null;
    }

    const capability = OPERATION_CAPABILITY[operation];
    const categories = category
      ? [category]
      : this._defaultCategoriesForOperation(operation, sourceUrl);

    for (const category of categories) {
      const resolved = await this._defaultsResolution.resolve('media', category, orgId);
      if (!resolved) continue;

      const credentials = await this._credentialsForMediaProvider(
        orgId,
        resolved.providerId,
        resolved.version,
      );
      if (!credentials || Object.keys(credentials).length === 0) continue;

      const adapter = this._resolveMediaAdapter(resolved.providerId, {
        version: resolved.version,
        credentials,
        orgId,
      });
      if (!adapter || !adapter.capabilities[capability]) continue;

      return { adapter, credentials, version: resolved.version };
    }

    return null;
  }

  private async _credentialsForMediaProvider(
    orgId: string,
    providerId: string,
    version = 'v1',
  ): Promise<Record<string, string> | null> {
    // 1) Dedicated media provider config (also handles OpenAI/MiniMax mirror and
    // universal AI-credential providers such as Qwen).
    const mediaConfig = await this._orgMediaProviderSettings
      ?.getConfigForProvider(orgId, providerId, version)
      .catch(() => null);
    if (mediaConfig && Object.keys(mediaConfig.credentials).length > 0) {
      return mediaConfig.credentials;
    }

    // 1.1 (review): a null step-1 result is ambiguous — "no media row" vs "media
    // row explicitly DISABLED". When the org deliberately switched the media
    // provider off (e.g. openai media off to stop image spend, LLM kept on),
    // falling through to the raw AI row below would route around that disable
    // and keep billing the key on this surface. Stop here instead.
    if (
      typeof this._orgMediaProviderSettings?.isProviderExplicitlyDisabled ===
        'function' &&
      (await this._orgMediaProviderSettings
        .isProviderExplicitlyDisabled(orgId, providerId)
        .catch(() => false))
    ) {
      return null;
    }

    // 2) Fall back to a plain AIOrgProviderConfig for AI providers that expose a
    // media adapter but have no media-side row. Version-agnostic read (1.2 — a
    // v2-pinned AI row must still be found) and the AI row's own `enabled:false`
    // is honored (1.1b).
    // layering: sanctioned leaf-read (see constructor comment for DI-cycle rationale).
    if (!this._orgAiSettingsRepository || !this._encryptionService) return null;
    const aiConfig = await this._orgAiSettingsRepository
      .findAnyByIdentifier(orgId, providerId)
      .catch(() => null);
    if (!aiConfig?.credentials || aiConfig.enabled === false) return null;
    try {
      const decrypted = this._encryptionService.decrypt(aiConfig.credentials);
      return JSON.parse(decrypted) as Record<string, string>;
    } catch {
      return null;
    }
  }

  // Lazy, guarded singletons for the @reaatech media-pipeline infra packages.
  // `null` = not yet resolved; `false` = resolved-and-unavailable (don't retry).
  private _costLedger: CostLedgerLike | null | false = null;
  private _provenanceSigner: ProvenanceSignerLike | null | false = null;

  invalidateProviderCache(): void {
    this._costLedger = null;
    this._provenanceSigner = null;
  }

  // Detect a normalized focal point for an image using the org's vision-capable AI
  // provider when available. Falls back to center (0.5, 0.5) non-fatally when AI is
  // off, the model lacks vision, or the call fails.
  async listVoices(
    orgId: string,
    options?: { provider?: string },
  ): Promise<Array<{ id: string; label: string; previewUrl?: string }>> {
    const enabled = await this._safeGetEnabledProviders(orgId);
    const candidates = options?.provider
      ? enabled.filter((cfg) => cfg.identifier === options.provider)
      : enabled.filter((cfg) => {
          const adapter = this._resolveMediaAdapter(cfg.identifier);
          return !!adapter?.capabilities.tts && typeof adapter.listVoices === 'function';
        });

    for (const cfg of candidates) {
      const adapter = this._resolveMediaAdapter(cfg.identifier);
      if (!adapter?.listVoices) continue;
      try {
        const full = await this._orgMediaProviderSettings!.getConfigForProvider(orgId, cfg.identifier);
        if (!full || Object.keys(full.credentials).length === 0) continue;
        return await adapter.listVoices({ credentials: full.credentials });
      } catch (err) {
        this._logger.warn(
          `Media provider ${cfg.identifier} voice list failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Voice list is not available. Configure a TTS-capable media provider (ElevenLabs or OpenAI) in Settings > Media.',
      'speech',
    );
  }

  async detectFocalPoint(
    imageUrl: string,
    options?: { orgId?: string },
  ): Promise<{ x: number; y: number; source: 'provider' | 'fallback' }> {
    const fallback = { x: 0.5, y: 0.5, source: 'fallback' as const };
    if (!options?.orgId || !this._defaultsResolution) {
      return fallback;
    }

    try {
      const visionDefault = await this._defaultsResolution.resolve(
        'ai',
        'vision',
        options.orgId,
      );
      if (!visionDefault) {
        return fallback;
      }

      const text = await this._aiModelProvider.generateTextWithModel(
        options.orgId,
        visionDefault.providerId,
        visionDefault.version,
        visionDefault.model,
        {
          imageUrl,
          prompt:
            'You are an image-composition assistant. Given an image, identify the main subject or area of interest and return its normalized center coordinates as JSON: {"x": number, "y": number} where each value is between 0 and 1. Return only the JSON object, no markdown or explanation.',
        },
      );

      const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (
        typeof parsed?.x === 'number' &&
        typeof parsed?.y === 'number' &&
        !Number.isNaN(parsed.x) &&
        !Number.isNaN(parsed.y)
      ) {
        return {
          x: Math.min(1, Math.max(0, parsed.x)),
          y: Math.min(1, Math.max(0, parsed.y)),
          source: 'provider',
        };
      }
    } catch (err) {
      this._logger.warn(
        `detectFocalPoint failed: ${(err as Error).message}`,
      );
    }

    return fallback;
  }

  // 4F — read-only summary of configured media providers for the user-facing Brand & AI
  // settings panel. Returns one entry per media operation listing the org-enabled
  // providers (by id) whose adapter declares the capability. Never returns credentials.
  async getMediaProviderSummary(orgId?: string): Promise<MediaProviderSummaryEntry[]> {
    const enabled =
      orgId && this._orgMediaProviderSettings
        ? await this._safeGetEnabledProviders(orgId)
        : [];

    return ALL_MEDIA_OPERATIONS.map((operation) => {
      const capability = OPERATION_CAPABILITY[operation];
      const providers = enabled
        .filter((cfg) => {
          const adapter = this._resolveMediaAdapter(cfg.identifier);
          if (!adapter?.capabilities[capability]) return false;
          const ops = cfg.extraConfig.operations;
          return !ops || ops.length === 0 || ops.includes(operation);
        })
        .map((cfg) => ({
          id: cfg.identifier,
          enabled: true,
          c2paAvailable: !!cfg.extraConfig.c2paAvailable,
        }));
      return { operation, available: providers.length > 0, providers };
    });
  }

  // The single source of truth for media-tool availability. Availability is computed with
  // the EXACT predicate the generate path uses (`_resolveForOperation` + the image
  // AI-fallback), so `/media/tools/status` cannot say "available" while a generate call
  // 409s (or vice-versa). provider/model on the per-category `tools` map are best-effort
  // display detail (the resolved default); they never affect the `available` decision.
  async getToolStatus(orgId?: string): Promise<MediaToolStatus> {
    const operations = {} as MediaToolStatus['operations'];

    for (const op of ALL_MEDIA_OPERATIONS) {
      let candidates: ResolvedMediaProvider[] = [];
      try {
        candidates = await this._resolveForOperation(orgId, op);
      } catch {
        candidates = [];
      }
      let available = candidates.length > 0;
      let provider = candidates[0]?.adapter.identifier;

      // Image generation has a behaviour-preserving fallback onto the AI facade's
      // imageModel() (see generateImageResult), so image is "available" even with no
      // image-capable media provider when the org has an AI image model.
      if (!available && op === 'image' && orgId) {
        try {
          const model = await this._aiModelProvider.imageModel('utility', orgId);
          if (model) {
            available = true;
            provider = 'ai-media';
          }
        } catch {
          // no AI image model → stays unavailable
        }
      }

      operations[op] = { available, provider };
    }

    const tools = {} as MediaToolStatus['tools'];
    for (const category of AI_MEDIA_CATEGORIES) {
      const op = MEDIA_CATEGORY_OPERATION[category];
      const opStatus = operations[op];
      const entry: MediaToolStatusEntry = {
        available: opStatus.available,
        provider: opStatus.provider,
      };
      if (!opStatus.available) {
        entry.reason = 'No provider configured — enable one in Settings → Media.';
      } else if (orgId && this._defaultsResolution) {
        // Best-effort: surface the resolved default provider/version/model for display
        // and so Settings can offer a provider-level option. Never gates availability.
        try {
          const resolved = await this._defaultsResolution.resolve('media', category, orgId);
          if (resolved) {
            entry.provider = resolved.providerId;
            entry.version = resolved.version;
            entry.model = resolved.model;
          }
        } catch {
          // keep the operation-level provider
        }
      }
      tools[category] = entry;
    }

    return { operations, tools };
  }

  // ── Controller-delegated media utilities (A-20) ──

  async getVideoOptions(orgId: string): Promise<Record<string, { available: boolean }>> {
    const categories = [
      'text-to-video',
      'image-to-video',
      'video-to-video',
      'video-upscale',
      'video-background',
      'video-avatar',
    ];
    const options: Record<string, { available: boolean }> = {};
    for (const category of categories) {
      try {
        const resolved = await this._defaultsResolution?.resolve('media', category, orgId);
        options[category] = { available: !!resolved };
      } catch {
        options[category] = { available: false };
      }
    }
    return options;
  }

  async urlToBase64Image(url: string): Promise<string> {
    if (url.startsWith('data:image/')) return url;
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  async saveUrlToFile(
    orgId: string,
    url: string,
    namePrefix: string,
  ): Promise<{ id: string; path: string; name: string }> {
    if (!this._storageService || !this._fileService) {
      throw new Error('Storage/file services are not available');
    }
    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    let buffer: Buffer;
    let ext = 'png';
    if (url.startsWith('data:')) {
      const commaIdx = url.indexOf(',');
      const header = url.slice(5, commaIdx);
      const payload = url.slice(commaIdx + 1);
      const isBase64 = header.endsWith(';base64');
      const mime = isBase64 ? header.slice(0, -7) : header;
      buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8');
      ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    } else {
      const res = await safeFetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      buffer = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type')?.split(';')[0] || '';
      ext = ct === 'image/jpeg' ? 'jpg' : ct === 'image/webp' ? 'webp' : 'png';
    }
    const path = await adapter.writeBuffer(
      buffer,
      `image/${ext === 'png' ? 'png' : ext === 'jpg' ? 'jpeg' : 'webp'}`,
    );
    const fileName = `${namePrefix}-${Date.now()}.${ext}`;
    const saved = await this._fileService.saveFile(orgId, fileName, path, fileName);
    return { id: saved.id, path: saved.path, name: saved.name };
  }

  async listVoicesCached(
    orgId: string,
    provider?: string,
  ): Promise<Array<{ id: string; label: string; previewUrl?: string }>> {
    const cacheKey = `media:voices:${orgId}:${provider || '_default'}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Fall through to fresh fetch if cache value is corrupt.
      }
    }

    const voices = await this.listVoices(orgId, { provider });
    await ioRedis.set(cacheKey, JSON.stringify(voices), 'EX', 60);
    return voices;
  }

  async uploadFont(
    orgId: string,
    file: Express.Multer.File,
  ): Promise<{ fonts: any[]; uploaded: { family: string; fileId: string; path: string; weights: number[] } }> {
    if (!this._storageService || !this._brandsService) {
      throw new Error('Storage/brands services are not available');
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const allowedExts = new Set(['ttf', 'otf', 'woff2']);
    if (!ext || !allowedExts.has(ext)) {
      throw new BadRequestException('Invalid font file. Accepted: .ttf, .otf, .woff2');
    }

    const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
    const uploaded = await adapter.uploadFile(file);

    const fontEntry = {
      family: file.originalname.replace(/\.[^./\\]*$/, ''),
      fileId: uploaded.filename || uploaded.originalname,
      path: uploaded.path,
      weights: [400],
    };

    const fonts = await this._brandsService.addCustomFont(orgId, fontEntry);
    return { fonts, uploaded: fontEntry };
  }

  async textToSpeechAndSave(
    text: string,
    options: { orgId: string; voice?: string },
  ): Promise<{ id: string; path: string; name: string }> {
    if (!this._storageService || !this._fileService) {
      throw new Error('Storage/file services are not available');
    }
    const buffer = await this.textToSpeech(text, options);
    const adapter = await this._storageService.getLocalAdapterForOrg(options.orgId, true);
    const fileName = `voiceover-${Date.now()}.mp3`;
    const path = await adapter.writeBuffer(
      Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'base64'),
      'audio/mpeg',
    );
    const saved = await this._fileService.saveFile(options.orgId, fileName, path, fileName);
    return { id: saved.id, path: saved.path, name: saved.name };
  }

  private async _safeGetEnabledProviders(orgId: string) {
    try {
      return (await this._orgMediaProviderSettings?.getEnabledProviders(orgId)) || [];
    } catch (err) {
      this._logger.warn(`Could not load media provider configs: ${(err as Error).message}`);
      return [];
    }
  }

  // Capability-driven resolution over the org's enabled + credentialed
  // `MediaProviderConfig` rows. The org's explicit media default (if set) is tried
  // first; otherwise we fall back to the previous alphabetical candidate list.
  private async _resolveForOperation(
    orgId: string | undefined,
    operation: MediaOperation,
    sourceUrl?: string,
    category?: string,
  ): Promise<ResolvedMediaProvider[]> {
    if (!orgId || !this._orgMediaProviderSettings) return [];

    const enabled = await this._safeGetEnabledProviders(orgId);
    const capability = OPERATION_CAPABILITY[operation];
    const resolved: ResolvedMediaProvider[] = [];

    const defaultProvider = await this._resolveDefaultForOperation(
      operation,
      orgId,
      sourceUrl,
      category,
    );
    if (defaultProvider) {
      resolved.push(defaultProvider);
    }

    for (const cfg of [...enabled].sort((a, b) => a.identifier.localeCompare(b.identifier))) {
      if (defaultProvider && cfg.identifier === defaultProvider.adapter.identifier) continue;

      const adapter = this._resolveMediaAdapter(cfg.identifier);
      if (!adapter || !adapter.capabilities[capability]) continue;

      const ops = cfg.extraConfig.operations;
      if (ops && ops.length > 0 && !ops.includes(operation)) continue;

      const full = await this._orgMediaProviderSettings.getConfigForProvider(orgId, cfg.identifier);
      if (!full || Object.keys(full.credentials).length === 0) continue;

      // Re-resolve with the config-pinned version + credentials so the kernel runs
      // the adapter version recorded at write time.
      const pinned =
        this._resolveMediaAdapter(cfg.identifier, {
          version: full.version,
          credentials: full.credentials,
          orgId,
        }) ?? adapter;

      resolved.push({ adapter: pinned, credentials: full.credentials, version: full.version });
    }
    return resolved;
  }

  // ── @reaatech/media-pipeline-mcp-cost — per-call cost ledger (§2.4/§6.4) ──
  private async _getCostLedger(): Promise<CostLedgerLike | null> {
    if (this._costLedger !== null) return this._costLedger || null;
    try {
      const { InMemoryCostLedger } = await import('@reaatech/media-pipeline-mcp-cost');
      this._costLedger = new InMemoryCostLedger() as CostLedgerLike;
    } catch (err) {
      this._logger.warn(`media-pipeline-mcp-cost unavailable: ${(err as Error)?.message}`);
      this._costLedger = false;
    }
    return this._costLedger || null;
  }

  // ── @reaatech/media-pipeline-mcp-provenance — C2PA signing (§3.5.20) ──
  // Off unless settings.ragSettings.provenance.enabled with a signing key. Degrades
  // to unsigned output silently when disabled or unavailable (risk register).
  private async _getProvenanceSigner(): Promise<ProvenanceSignerLike | null> {
    if (this._provenanceSigner !== null) return this._provenanceSigner || null;
    try {
      const settings = await this._aiSettingsManager.getSettings();
      const prov: ProvenanceSettings | undefined = settings?.ragSettings?.provenance;
      if (!prov?.enabled || !prov?.signingKey) {
        this._provenanceSigner = false;
        return null;
      }
      const { ProvenanceSigner } = await import('@reaatech/media-pipeline-mcp-provenance');
      this._provenanceSigner = new ProvenanceSigner({
        enabled: true,
        signingKey: prov.signingKey,
        signGenerativeOnly: prov.signGenerativeOnly ?? true,
        embedMode: prov.embedMode ?? 'sidecar',
      } as ConstructorParameters<typeof ProvenanceSigner>[0]) as ProvenanceSignerLike;
    } catch (err) {
      this._logger.warn(`media-pipeline-mcp-provenance unavailable: ${(err as Error)?.message}`);
      this._provenanceSigner = false;
    }
    return this._provenanceSigner || null;
  }

  private async _signProvenance(
    operation: MediaOperation,
    provider: string,
    model: string,
    artifactUrl?: string,
  ): Promise<string | undefined> {
    if (!PROVENANCE_OPERATIONS.has(operation) || !artifactUrl) return undefined;
    const signer = await this._getProvenanceSigner();
    if (!signer) return undefined;
    try {
      const runId = `media-${Date.now()}-${randomBytes(3).toString('hex')}`;
      const result = await signer.sign(artifactUrl, {
        title: `AI ${operation}`,
        format: 'application/octet-stream',
        claimGenerator: 'postmill/ai-media',
        pipelineDefHash: 'na',
        runId,
        generatedAt: new Date().toISOString(),
        assertions: [
          {
            kind: 'c2pa.actions',
            actions: [{ action: 'c2pa.created', when: new Date().toISOString(), softwareAgent: provider }],
          },
          { kind: 'c2pa.model', providerId: provider, modelId: model },
        ],
      });
      return result?.manifestUri;
    } catch (err) {
      this._logger.warn(`Provenance signing failed (continuing unsigned): ${(err as Error)?.message}`);
      return undefined;
    }
  }

  private async _chargeCost(
    operation: MediaOperation,
    provider: string,
    model: string,
    orgId?: string,
  ): Promise<number> {
    const usd = OPERATION_COST_USD[operation] ?? 0;
    const ledger = await this._getCostLedger();
    if (ledger) {
      try {
        await ledger.charge({
          id: `media-${Date.now()}-${randomBytes(3).toString('hex')}`,
          runId: orgId ?? 'system',
          tenantId: orgId,
          stepId: operation,
          provider,
          operation,
          modelId: model,
          inputUnits: 1,
          outputUnits: 1,
          inputUnitType: 'requests',
          outputUnitType: 'requests',
          usd,
          at: new Date().toISOString(),
        });
      } catch (err) {
        this._logger.warn(`Cost ledger charge failed: ${(err as Error)?.message}`);
      }
    }

    // Mirror media generation spend into the AI budget ledger so org caps
    // cover image/video/audio/etc. Failures are non-fatal — the job already ran.
    if (this._budget) {
      try {
        await this._budget.recordSpend({
          scope: 'media',
          organizationId: orgId,
          provider,
          model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: usd,
        });
      } catch (err) {
        this._logger.warn(`Media spend recording failed: ${(err as Error)?.message}`);
      }
    }

    return usd;
  }

  // Single funnel for persisting a finished (synchronous) media job with the §2.4/§6.4
  // metadata: real $ cost (-cost), legacy creditType mapping and optional C2PA
  // provenance (-provenance). Async jobs go through MediaJobLifecycleService instead.
  private async _persistJob(params: {
    operation: MediaOperation;
    provider: string;
    model?: string;
    orgId?: string;
    userId?: string;
    artifactUrl?: string;
    status?: string;
    error?: string;
  }): Promise<{ artifactUrl?: string; provenance?: string; costUsd: number }> {
    const model = params.model || params.provider;
    const costUsd = await this._chargeCost(params.operation, params.provider, model, params.orgId);
    const provenance = await this._signProvenance(
      params.operation,
      params.provider,
      model,
      params.artifactUrl,
    );

    if (params.orgId) {
      await this._aiSettings.createMediaJob({
        organizationId: params.orgId,
        userId: params.userId,
        provider: params.provider,
        operation: params.operation,
        status: params.status ?? 'done',
        artifactUrl: params.artifactUrl || undefined,
        provenance,
        costUsd,
        creditType: OPERATION_CREDIT_TYPE[params.operation],
        error: params.error,
      });
    }

    return { artifactUrl: params.artifactUrl, provenance, costUsd };
  }

  // ── Image (synchronous, §10.3/§11.2) ──

  // All image generation routes through the media surface: org-configured image-capable
  // media providers first (standardized result), then the AI facade's imageModel() as a
  // behaviour-preserving fallback for orgs with no image-capable media provider.
  async generateImageResult(
    prompt: string,
    options?: { size?: string; orgId?: string; userId?: string; isVertical?: boolean; sourceUrl?: string },
  ): Promise<MediaGenerationResult> {
    const size = options?.size || (options?.isVertical ? '1024x1536' : undefined);
    const candidates = await this._resolveForOperation(options?.orgId, 'image', options?.sourceUrl);

    for (const candidate of candidates) {
      try {
        const result = await candidate.adapter.generateImage(prompt, {
          credentials: candidate.credentials,
          size,
          sourceUrl: options?.sourceUrl,
        });
        const first = result.image || result.images?.[0];
        if (!first) throw new Error('adapter returned no image');
        await this._persistJob({
          operation: 'image',
          provider: candidate.adapter.identifier,
          model: result.metadata?.model,
          orgId: options?.orgId,
          userId: options?.userId,
          artifactUrl: first,
        });
        return {
          multi: !!result.multi && (result.images?.length || 0) > 1,
          image: first,
          images: result.images?.length ? result.images : [first],
          metadata: result.metadata,
        };
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} image generation failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    // Fallback: the AI provider facade (today's behaviour when no media provider is set).
    const model = await this._aiModelProvider.imageModel('utility', options?.orgId);
    if (!model) {
      throw new CapabilityNotAvailable('Image generation is not available on the current AI provider', 'image');
    }
    const url = await model.generate(prompt, { size });

    await this._persistJob({
      operation: 'image',
      provider: 'ai-media',
      orgId: options?.orgId,
      userId: options?.userId,
      artifactUrl: url,
    });

    return { multi: false, image: url, images: [url] };
  }

  async generateImage(
    prompt: string,
    options?: { size?: string; orgId?: string; userId?: string; isVertical?: boolean; sourceUrl?: string },
  ): Promise<string> {
    const result = await this.generateImageResult(prompt, options);
    return result.image || '';
  }

  // ── Async generation (video / audio / avatar, §11.2) ──

  // Starts a tracked async job. Returns the AIMediaJob id (poll `/ai/media-jobs`), or —
  // for providers that complete synchronously — the stored artifact URL.
  private async _startAsyncJob(
    operation: AsyncOperation,
    prompt: string,
    options?: {
      orgId?: string;
      userId?: string;
      sourceUrl?: string;
      voice?: string;
      category?: string;
    },
  ): Promise<string> {
    const candidates = await this._resolveForOperation(
      options?.orgId,
      operation,
      options?.sourceUrl,
      options?.category,
    );
    if (candidates.length === 0) {
      throw new CapabilityNotAvailable(
        `No media provider with ${operation} capability is configured. Configure one in Settings > Media.`,
        operation === 'audio' ? 'speech' : 'video',
      );
    }

    let lastError: Error | undefined;
    for (const candidate of candidates) {
      const method =
        operation === 'video'
          ? candidate.adapter.generateVideo.bind(candidate.adapter)
          : operation === 'audio'
            ? candidate.adapter.generateAudio.bind(candidate.adapter)
            : candidate.adapter.generateAvatar.bind(candidate.adapter);

      // Tracked path — requires an org (the job ledger is org-scoped) and the lifecycle service.
      if (options?.orgId && this._lifecycle) {
        const costUsd = await this._chargeCost(
          operation,
          candidate.adapter.identifier,
          candidate.adapter.identifier,
          options.orgId,
        );
        const job = await this._lifecycle.createPendingJob({
          organizationId: options.orgId,
          userId: options.userId,
          provider: candidate.adapter.identifier,
          operation,
          costUsd,
          creditType: OPERATION_CREDIT_TYPE[operation],
          version: candidate.version ?? 'v1',
        });

        try {
          const submission = await method(prompt, {
            credentials: candidate.credentials,
            sourceUrl: options?.sourceUrl,
            voice: options?.voice,
            webhookUrl: this._lifecycle.webhookUrlFor(job.id, options.orgId),
          });

          if (submission.artifactUrl) {
            // Synchronous provider — complete immediately (download + store + notify).
            await this._lifecycle.completeJob(job, submission.artifactUrl, submission.metadata);
            const finished = await this._lifecycle.getJob(job.id, options.orgId!);
            return finished?.artifactUrl || job.id;
          }

          await this._lifecycle.attachProviderJob(job.id, submission.jobId, options.orgId!);
          return job.id;
        } catch (err) {
          lastError = err as Error;
          this._logger.warn(
            `Media provider ${candidate.adapter.identifier} ${operation} failed: ${lastError.message} — trying next`,
          );
          await this._lifecycle.failJob(job, lastError.message, { notify: false });
        }
        continue;
      }

      // Untracked path (no org context) — submit and return the provider's raw job id.
      try {
        const submission = await method(prompt, {
          credentials: candidate.credentials,
          sourceUrl: options?.sourceUrl,
          voice: options?.voice,
        });
        await this._persistJob({
          operation,
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          userId: options?.userId,
        });
        return submission.artifactUrl || submission.jobId;
      } catch (err) {
        lastError = err as Error;
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} ${operation} failed: ${lastError.message} — trying next`,
        );
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new CapabilityNotAvailable(
      `No media provider with ${operation} capability is configured. Configure one in Settings > Media.`,
      operation === 'audio' ? 'speech' : 'video',
    );
  }

  async generateVideo(
    prompt: string,
    options?: { orgId?: string; userId?: string; sourceUrl?: string; category?: string },
  ): Promise<string> {
    return this._startAsyncJob('video', prompt, options);
  }

  generateAudio(
    prompt: string,
    options?: { orgId?: string; userId?: string; voice?: string },
  ): Promise<string> {
    return this._startAsyncJob('audio', prompt, options);
  }

  generateAvatar(
    prompt: string,
    options?: { orgId?: string; userId?: string; sourceUrl?: string },
  ): Promise<string> {
    return this._startAsyncJob('avatar', prompt, options);
  }

  // ── Speech (synchronous) ──

  async textToSpeech(
    text: string,
    options?: { voice?: string; orgId?: string; userId?: string },
  ): Promise<Buffer> {
    const candidates = await this._resolveForOperation(options?.orgId, 'tts');

    for (const candidate of candidates) {
      if (!candidate.adapter.textToSpeech) continue;
      try {
        const result = await candidate.adapter.textToSpeech(text, {
          credentials: candidate.credentials,
          voice: options?.voice,
        });
        await this._persistJob({
          operation: 'tts',
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          userId: options?.userId,
        });
        if (Buffer.isBuffer(result)) return result;
        if (typeof result === 'string') return Buffer.from(result, 'base64');
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} TTS failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Text-to-speech is not available. Configure a TTS-capable media provider (ElevenLabs or OpenAI) in Settings > Media.',
      'speech',
    );
  }

  async speechToText(
    audio: Buffer,
    options?: { orgId?: string; userId?: string },
  ): Promise<string> {
    const candidates = await this._resolveForOperation(options?.orgId, 'stt');

    for (const candidate of candidates) {
      if (!candidate.adapter.speechToText) continue;
      try {
        const text = await candidate.adapter.speechToText(audio, {
          credentials: candidate.credentials,
        });
        await this._persistJob({
          operation: 'stt',
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          userId: options?.userId,
        });

        // §11.1: persist the transcript as a document under documents/ (best-effort).
        if (options?.orgId && this._lifecycle) {
          try {
            await this._lifecycle.storeTranscript({
              organizationId: options.orgId,
              provider: candidate.adapter.identifier,
              text,
            });
          } catch (err) {
            this._logger.warn(`Transcript storage failed (non-fatal): ${(err as Error).message}`);
          }
        }

        return text;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} STT failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Speech-to-text is not available. Configure an STT-capable media provider (Deepgram or OpenAI) in Settings > Media.',
      'speech',
    );
  }

  async speechToTextWords(
    audio: Buffer,
    options?: { orgId?: string; userId?: string },
  ): Promise<{ text: string; words: { word: string; start: number; end: number }[] }> {
    const candidates = await this._resolveForOperation(options?.orgId, 'stt');

    for (const candidate of candidates) {
      if (!candidate.adapter.speechToTextWords) continue;
      try {
        const result = await candidate.adapter.speechToTextWords(audio, {
          credentials: candidate.credentials,
        });
        await this._persistJob({
          operation: 'stt',
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          userId: options?.userId,
        });
        return result;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} word-level STT failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    // Fallback: use plain STT and split heuristically by duration if word timestamps unavailable.
    const text = await this.speechToText(audio, options);
    const words = text.split(/\s+/).filter(Boolean).map((word, i, arr) => ({
      word,
      start: i / arr.length,
      end: (i + 1) / arr.length,
    }));
    return { text, words };
  }

  // ── Image edits (synchronous) ──

  async upscaleImage(imageUrl: string, options?: { orgId?: string; scale?: number }): Promise<string> {
    const candidates = await this._resolveForOperation(options?.orgId, 'upscale');

    for (const candidate of candidates) {
      if (!candidate.adapter.upscaleImage) continue;
      try {
        const result = await candidate.adapter.upscaleImage(imageUrl, {
          credentials: candidate.credentials,
          scale: options?.scale,
        });
        if (!result) continue;
        const persisted = await this._persistJob({
          operation: 'upscale',
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          artifactUrl: result,
        });
        return persisted.artifactUrl || result;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} upscale failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    this._logger.warn('Upscale not available — returning original');
    return imageUrl;
  }

  async removeBackground(imageUrl: string, options?: { orgId?: string }): Promise<string> {
    const candidates = await this._resolveForOperation(options?.orgId, 'bg-remove');

    for (const candidate of candidates) {
      if (!candidate.adapter.removeBackground) continue;
      try {
        const result = await candidate.adapter.removeBackground(imageUrl, {
          credentials: candidate.credentials,
        });
        if (!result) continue;
        const persisted = await this._persistJob({
          operation: 'bg-remove',
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          artifactUrl: result,
        });
        return persisted.artifactUrl || result;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} bg-remove failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Background removal is not available. Configure a media provider with image-edit support (Replicate) in Settings > Media.',
      'image_edit',
    );
  }

  async inpaintImage(
    imageUrl: string,
    maskUrl: string,
    prompt: string,
    options?: { orgId?: string },
  ): Promise<string> {
    const candidates = await this._resolveForOperation(options?.orgId, 'inpaint');

    for (const candidate of candidates) {
      if (!candidate.adapter.inpaintImage) continue;
      try {
        const result = await candidate.adapter.inpaintImage(imageUrl, maskUrl, prompt, {
          credentials: candidate.credentials,
        });
        if (!result) continue;
        const persisted = await this._persistJob({
          operation: 'inpaint',
          provider: candidate.adapter.identifier,
          orgId: options?.orgId,
          artifactUrl: result,
        });
        return persisted.artifactUrl || result;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} inpaint failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Inpainting is not available. Configure a media provider with image-edit support (Replicate) in Settings > Media.',
      'image_edit',
    );
  }

  // ── Video edits (async) ──

  async upscaleVideo(videoUrl: string, options?: { orgId?: string; scale?: number }): Promise<string> {
    const candidates = await this._resolveForOperation(options?.orgId, 'video-upscale');

    for (const candidate of candidates) {
      if (!candidate.adapter.upscaleVideo) continue;
      try {
        const submission = await candidate.adapter.upscaleVideo(videoUrl, {
          credentials: candidate.credentials,
          scale: options?.scale,
        });
        if (options?.orgId && this._lifecycle) {
          const costUsd = await this._chargeCost('video-upscale', candidate.adapter.identifier, candidate.adapter.identifier, options.orgId);
          const job = await this._lifecycle.createPendingJob({
            organizationId: options.orgId,
            provider: candidate.adapter.identifier,
            operation: 'video-upscale',
            costUsd,
            creditType: OPERATION_CREDIT_TYPE['video-upscale'],
            version: candidate.version ?? 'v1',
          });
          if (submission.artifactUrl) {
            await this._lifecycle.completeJob(job, submission.artifactUrl, submission.metadata);
            const finished = await this._lifecycle.getJob(job.id, options.orgId!);
            return finished?.artifactUrl || job.id;
          }
          await this._lifecycle.attachProviderJob(job.id, submission.jobId, options.orgId!);
          return job.id;
        }
        return submission.artifactUrl || submission.jobId;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} video upscale failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Video upscaling is not available. Configure a media provider with video-upscale support (Replicate) in Settings > Media.',
      'video',
    );
  }

  async removeVideoBackground(videoUrl: string, options?: { orgId?: string }): Promise<string> {
    const candidates = await this._resolveForOperation(options?.orgId, 'video-bg');

    for (const candidate of candidates) {
      if (!candidate.adapter.removeVideoBackground) continue;
      try {
        const submission = await candidate.adapter.removeVideoBackground(videoUrl, {
          credentials: candidate.credentials,
        });
        if (options?.orgId && this._lifecycle) {
          const costUsd = await this._chargeCost('video-bg', candidate.adapter.identifier, candidate.adapter.identifier, options.orgId);
          const job = await this._lifecycle.createPendingJob({
            organizationId: options.orgId,
            provider: candidate.adapter.identifier,
            operation: 'video-bg',
            costUsd,
            creditType: OPERATION_CREDIT_TYPE['video-bg'],
            version: candidate.version ?? 'v1',
          });
          if (submission.artifactUrl) {
            await this._lifecycle.completeJob(job, submission.artifactUrl, submission.metadata);
            const finished = await this._lifecycle.getJob(job.id, options.orgId!);
            return finished?.artifactUrl || job.id;
          }
          await this._lifecycle.attachProviderJob(job.id, submission.jobId, options.orgId!);
          return job.id;
        }
        return submission.artifactUrl || submission.jobId;
      } catch (err) {
        this._logger.warn(
          `Media provider ${candidate.adapter.identifier} video background removal failed: ${(err as Error).message} — trying next`,
        );
      }
    }

    throw new CapabilityNotAvailable(
      'Video background removal is not available. Configure a media provider with video-bg support (Replicate) in Settings > Media.',
      'video',
    );
  }

  // ── Orchestrated pipelines (slide / caption) ──

  async generateSlide(
    orgId: string,
    prompt: string,
    imageUrls?: string[],
    options?: { userId?: string; slides?: number; durationPerSlideSeconds?: number },
  ): Promise<string> {
    if (!this._moduleRef) {
      throw new CapabilityNotAvailable(
        'Slide generation is not available. Configure a media provider with image capability in Settings > Media.',
        'video',
      );
    }
    // Lazy require (not a top-level import) to avoid the circular boot-time require — see note at imports.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SlideService } = require('@gitroom/nestjs-libraries/media/slide/slide.service');
    const slideService = this._moduleRef.get<SlideService>(SlideService, {
      strict: false,
    });
    return slideService.generateSlide({
      orgId,
      userId: options?.userId,
      prompt,
      imageUrls,
      slides: options?.slides,
      durationPerSlideSeconds: options?.durationPerSlideSeconds,
    });
  }

  async captionVideo(
    orgId: string,
    videoUrl: string,
    options?: { userId?: string; style?: 'srt' | 'ass' },
  ): Promise<string> {
    if (!this._moduleRef) {
      throw new CapabilityNotAvailable(
        'Video captioning is not available. Configure an STT-capable provider in Settings > Media.',
        'speech',
      );
    }
    // Lazy require (not a top-level import) to avoid the circular boot-time require — see note at imports.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CaptionService } = require('@gitroom/nestjs-libraries/media/caption/caption.service');
    const captionService = this._moduleRef.get<CaptionService>(CaptionService, {
      strict: false,
    });
    return captionService.captionVideo({
      orgId,
      userId: options?.userId,
      videoUrl,
      style: options?.style,
    });
  }
}
