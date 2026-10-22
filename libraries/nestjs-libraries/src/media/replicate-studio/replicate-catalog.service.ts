import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';
import { RedisService } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { OrgMediaProviderSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { CATEGORIES, MODEL_ALLOWLIST, isWarm, CategoryDefinition } from './replicate-catalog.allowlist';
import { pricingCategory, hasPrice, ReplicateCostService } from './replicate-cost';

const BASE = 'https://api.replicate.com/v1';
const CACHE_TTL = 86400; // 24h

export interface ModelSummary {
  id: string;
  name: string;
  description: string;
  coverImageUrl: string | null;
  runCount: number;
  warm: boolean;
  pricing: 'output' | 'usage';
  price: { kind: string; usd: number } | null;
}

export interface ModelDetail {
  id: string;
  name: string;
  coverImageUrl: string | null;
  warm: boolean;
  versionId: string;
  inputSchema: Record<string, unknown> | null;
}

interface ReplicateModelApi {
  owner: string;
  name: string;
  description?: string;
  cover_image_url?: string;
  run_count?: number;
  latest_version?: {
    id: string;
    openapi_schema?: {
      components?: {
        schemas?: {
          Input?: Record<string, unknown>;
        };
      };
    };
  };
}

@Injectable()
export class ReplicateCatalogService {
  constructor(
    private readonly _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    private readonly _redis: RedisService,
    private readonly _cost: ReplicateCostService,
  ) {}

  getCategories(): CategoryDefinition[] {
    return CATEGORIES;
  }

  async getReplicateKey(orgId: string): Promise<string> {
    const config = await this._orgMediaProviderSettings.getConfigForProvider(orgId, 'replicate');
    if (!config) {
      throw new NotFoundException('Replicate is not configured for this organization');
    }
    const credentials = config.credentials as Record<string, string> | undefined;
    const apiKey = credentials?.apiKey || credentials?.key || credentials?.token;
    if (!apiKey) {
      throw new NotFoundException('Replicate API key is not configured');
    }
    // getConfigForProvider already decrypted the credentials blob — the key
    // arrives plaintext. Do NOT decrypt again: EncryptionService.decrypt is
    // GCM-only and throws on non-v2: values, which broke this path (and with
    // it the whole Replicate studio) when plaintext pass-through was removed.
    return apiKey;
  }

  private async _fetchModel(owner: string, name: string, apiKey: string): Promise<ReplicateModelApi> {
    const res = await safeFetch(`${BASE}/models/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`Replicate model fetch failed for ${owner}/${name}: ${res.status}`);
    }
    return (await res.json()) as ReplicateModelApi;
  }

  private _summaryFrom(modelId: string, data: ReplicateModelApi): ModelSummary {
    const [, name] = modelId.split('/');
    return {
      id: modelId,
      name: data.name || name,
      description: data.description || '',
      coverImageUrl: data.cover_image_url || null,
      runCount: data.run_count || 0,
      warm: isWarm(modelId),
      pricing: pricingCategory(modelId),
      price: this._cost.getPrice(modelId),
    };
  }

  async listModels(categoryKey: string, orgId: string): Promise<ModelSummary[]> {
    const allowlist = MODEL_ALLOWLIST[categoryKey] || [];
    const category = CATEGORIES.find((c) => c.key === categoryKey);

    // Local categories have no models, and only the curated allowlist is
    // listed: the runner refuses anything outside it (`_assertModelAllowed`),
    // so surfacing Replicate collection extras here produced a picker full of
    // models that always fail with "Bad Request" at run time.
    if (category?.execution === 'local') return [];
    if (allowlist.length === 0) return [];

    // v3: key includes a hash of the curated allowlist, so editing the allowlist
    // self-invalidates the 24h cache (a stale v2 key once served a retired model
    // list for a full day after deploy).
    const allowlistHash = createHash('sha1').update(allowlist.join(',')).digest('hex').slice(0, 8);
    const categoryCacheKey = `replicate:category:v3:${allowlistHash}:${categoryKey}`;
    const cachedCategory = await this._redis.get(categoryCacheKey);
    if (cachedCategory) {
      return JSON.parse(cachedCategory);
    }

    const apiKey = await this.getReplicateKey(orgId);

    const byId = new Map<string, ModelSummary>();

    // Curated allowlist, in curated order.
    for (const modelId of allowlist) {
      const cacheKey = `replicate:model:${modelId}`;
      try {
        const cached = await this._redis.get(cacheKey);
        if (cached) {
          byId.set(modelId, JSON.parse(cached));
          continue;
        }
        const [owner, name] = modelId.split('/');
        const data = await this._fetchModel(owner, name, apiKey);
        const summary = this._summaryFrom(modelId, data);
        await this._redis.set(cacheKey, JSON.stringify(summary), CACHE_TTL);
        byId.set(modelId, summary);
      } catch {
        const cached = await this._redis.get(cacheKey);
        if (cached) byId.set(modelId, JSON.parse(cached));
      }
    }

    const results = Array.from(byId.values());
    if (results.length > 0) {
      await this._redis.set(categoryCacheKey, JSON.stringify(results), CACHE_TTL);
    }
    return results;
  }

  async getModel(owner: string, name: string, orgId: string): Promise<ModelDetail> {
    const modelId = `${owner}/${name}`;
    const apiKey = await this.getReplicateKey(orgId);

    const data = await this._fetchModel(owner, name, apiKey);

    const schemas = data.latest_version?.openapi_schema?.components?.schemas;
    const inputSchema = this._inlineEnumRefs(schemas?.Input || null, schemas);

    return {
      id: modelId,
      name: data.name || name,
      coverImageUrl: data.cover_image_url || null,
      warm: isWarm(modelId),
      versionId: data.latest_version?.id || '',
      inputSchema,
    };
  }

  // Replicate expresses every enum/constrained field as a separate component
  // schema referenced from the property — via `allOf`, `anyOf` or `oneOf`
  // (`{ $ref: '#/components/schemas/<name>' }`), e.g. aspect_ratio,
  // output_format, megapixels, scheduler, voice, style, … The Input schema alone
  // carries no `enum`/`type` for ANY of these, so the UI can't render a select.
  // Resolve the refs for EVERY property here and inline enum/type/min/max plus
  // the component's default/description — the property's own values always win
  // when both carry one (x-order stays on the property).
  private _inlineEnumRefs(
    input: any,
    schemas: Record<string, any> | undefined,
  ): any {
    if (!input?.properties || !schemas) return input;

    const resolveRef = (ref: unknown): any | undefined => {
      if (typeof ref !== 'string') return undefined;
      const m = /#\/components\/schemas\/(.+)$/.exec(ref);
      return m ? schemas[m[1]] : undefined;
    };

    // Find the first $ref anywhere a property can reference a component schema.
    const findRefSchema = (prop: any): any | undefined => {
      if (prop.$ref) {
        const r = resolveRef(prop.$ref);
        if (r) return r;
      }
      for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
        if (Array.isArray(prop[key])) {
          for (const entry of prop[key]) {
            const r = resolveRef(entry?.$ref);
            if (r) return r;
          }
        }
      }
      return undefined;
    };

    const properties: Record<string, any> = {};
    for (const [key, raw] of Object.entries<any>(input.properties)) {
      const prop = { ...raw };
      const ref = findRefSchema(prop);
      if (ref) {
        // Inline the referenced constraints, never overwriting the property's own.
        // `default`/`description` ride along too — without them a schema whose
        // defaults live on the $ref'd component (aspect_ratio, mode, …) seeds
        // the form empty (compare replicate-schema-to-model-fields.ts).
        for (const f of ['enum', 'type', 'minimum', 'maximum', 'title', 'default', 'description'] as const) {
          if (prop[f] == null && ref[f] != null) prop[f] = ref[f];
        }
        // Drop the now-resolved ref wrappers so the field renders directly.
        delete prop.allOf;
        delete prop.$ref;
        if (prop.enum != null) {
          delete prop.anyOf;
          delete prop.oneOf;
        }
      }
      properties[key] = prop;
    }
    return { ...input, properties };
  }
}
