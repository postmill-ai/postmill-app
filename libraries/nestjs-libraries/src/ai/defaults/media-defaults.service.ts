import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DefaultsResolutionService } from './defaults-resolution.service';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { DefaultsSettingsValidator } from './defaults-settings.validator';
import {
  AI_MEDIA_CATEGORIES,
  MEDIA_CATEGORY_OPERATION,
} from './default-categories';
import { SetDefaultModelDto } from '@gitroom/nestjs-libraries/dtos/ai-settings/default-model.dto';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel } from '@gitroom/provider-kernel';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

@Injectable()
export class MediaDefaultsService {
  constructor(
    private _defaultsResolution: DefaultsResolutionService,
    private _defaultsRepository: OrgDefaultModelRepository,
    private _settingsValidator: DefaultsSettingsValidator,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
  ) {}

  async getMediaDefaults(orgId: string) {
    const resolved = await this._defaultsResolution.resolveAll('media', orgId);
    const stored = await this._defaultsRepository.getAll(orgId, 'media');
    return {
      categories: AI_MEDIA_CATEGORIES.map((category) => {
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

  async setMediaDefault(
    orgId: string,
    category: string,
    body: SetDefaultModelDto,
  ) {
    const safeCategory = AI_MEDIA_CATEGORIES.find((c) => c === category);
    if (!safeCategory) {
      throw new BadRequestException(`Invalid media category: ${category}`);
    }
    const cleaned = this._sanitizeSettings('media', safeCategory, body);
    await this._defaultsRepository.upsert(orgId, 'media', safeCategory, cleaned);
    this._bustDefaultsCatalogCache(orgId);
    return { category: safeCategory, success: true };
  }

  async clearMediaDefault(orgId: string, category: string) {
    const safeCategory = AI_MEDIA_CATEGORIES.find((c) => c === category);
    if (!safeCategory) {
      throw new BadRequestException(`Invalid media category: ${category}`);
    }
    await this._defaultsRepository.remove(orgId, 'media', safeCategory);
    return { category: safeCategory, success: true };
  }

  async getMediaDefaultsCatalog(orgId: string, category: string) {
    const safeCategory = AI_MEDIA_CATEGORIES.find((c) => c === category);
    if (!safeCategory) {
      throw new BadRequestException(`Invalid media category: ${category}`);
    }
    const cacheKey = `settings:content:media-defaults:catalog:${orgId}:${safeCategory}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const candidates = await this._defaultsResolution.candidates(
      'media',
      safeCategory,
      orgId,
    );
    const options: {
      providerId: string;
      version: string;
      model?: string;
      label: string;
      fields?: any[];
    }[] = [];
    for (const c of candidates) {
      const providerLabel = this._providerLabel(c);
      const staticModels = this._staticModelsForCandidate(c, safeCategory);

      if (c.metadata.kind === 'action') {
        options.push({
          providerId: c.providerId,
          version: c.version,
          label: providerLabel,
        });
      } else if (c.metadata.hasModelList) {
        const models = await this._listModelsForCandidate(c, safeCategory, orgId);
        if (!models || models.length === 0) {
          // Configured model-list provider whose catalog couldn't be enumerated
          // (transient API failure / empty list). Still offer a provider-level option
          // (no model) so a working provider stays selectable — mirrors the resolver's
          // undefined-model auto-pick. If a static fallback catalog exists, expose it.
          if (staticModels.length > 0) {
            for (const m of staticModels) {
              options.push({
                providerId: c.providerId,
                version: c.version,
                model: m.id,
                label: `${providerLabel}: ${m.label || m.id}`,
                fields: m.fields,
              });
            }
          } else {
            options.push({
              providerId: c.providerId,
              version: c.version,
              label: providerLabel,
            });
          }
        } else {
          const fieldsById = new Map(staticModels.map((m) => [m.id, m.fields]));
          for (const m of models) {
            options.push({
              providerId: c.providerId,
              version: c.version,
              model: m.id,
              label: `${providerLabel}: ${m.label || m.id}`,
              fields: fieldsById.get(m.id) ?? [],
            });
          }
        }
      } else if (staticModels.length > 0) {
        for (const m of staticModels) {
          options.push({
            providerId: c.providerId,
            version: c.version,
            model: m.id,
            label: `${providerLabel}: ${m.label || m.id}`,
            fields: m.fields,
          });
        }
      } else {
        options.push({
          providerId: c.providerId,
          version: c.version,
          label: providerLabel,
        });
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
      version: body.version,
    });
    return { ...body, settings: cleaned };
  }

  private _bustDefaultsCatalogCache(orgId: string): void {
    // Best-effort cache invalidation; never fail the request if Redis is down.
    try {
      const prefix = `settings:content:media-defaults:catalog:${orgId}:`;
      ioRedis
        .keys(`${prefix}*`)
        .then((keys) => {
          if (keys.length) ioRedis.del(...keys);
        })
        .catch(() => undefined);
    } catch {}
  }

  private _providerLabel(candidate: {
    providerId: string;
    metadata: { uiName?: string };
  }): string {
    return candidate.metadata.uiName
      ? `${candidate.providerId}-${candidate.metadata.uiName}`
      : candidate.providerId;
  }

  private _listOperationForCategory(category: string): 'image' | 'video' | 'audio' {
    const mapped = MEDIA_CATEGORY_OPERATION[category as keyof typeof MEDIA_CATEGORY_OPERATION];
    switch (mapped) {
      case 'image':
      case 'upscale':
      case 'bg-remove':
      case 'inpaint':
      case 'focal-point':
      case 'slide':
        return 'image';
      case 'video':
      case 'avatar':
      case 'video-bg':
      case 'video-upscale':
        return 'video';
      case 'tts':
      case 'stt':
      case 'caption':
      case 'audio':
        return 'audio';
      default:
        return 'image';
    }
  }

  private _staticModelsForCandidate(
    candidate: { providerId: string; version: string; metadata: any },
    category: string,
  ): Array<{ id: string; label: string; fields: any[] }> {
    const categoryModels = candidate.metadata?.mediaModels?.[category];
    if (!Array.isArray(categoryModels)) return [];
    return categoryModels.map((m) => ({
      id: m.id,
      label: m.label || m.id,
      fields: Array.isArray(m.fields) ? m.fields : [],
    }));
  }

  private async _listModelsForCandidate(
    candidate: { providerId: string; version: string; metadata: any },
    category: string,
    orgId: string,
  ) {
    try {
      const config = await this._orgMediaProviderSettings.getConfigForProvider(
        orgId,
        candidate.providerId,
        candidate.version,
      );
      const credentials = config?.credentials ?? {};
      const mod = this._kernel?.get('media', candidate.providerId, candidate.version);
      const capability: any = mod?.create({
        credentials,
        encryption: {} as any,
        fetch: {} as any,
        logger: {} as any,
        telemetry: {} as any,
      });
      if (!capability?.listModels) return [];
      return await capability.listModels(this._listOperationForCategory(category), {
        credentials,
      });
    } catch {
      return [];
    }
  }
}
