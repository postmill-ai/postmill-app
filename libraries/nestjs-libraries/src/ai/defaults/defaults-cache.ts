import { createHash } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Best-effort invalidation of the AI/media defaults catalog cache for an org.
 * Extracted to a standalone helper so OrgAiSettingsService can trigger it without
 * creating a dependency-injection cycle with AiDefaultsService.
 */
export function bustDefaultsCatalogCache(orgId: string): void {
  try {
    const prefixes = [
      `settings:ai:defaults:catalog:${orgId}:`,
      `settings:content:media-defaults:catalog:${orgId}:`,
    ];
    for (const prefix of prefixes) {
      ioRedis
        .keys(`${prefix}*`)
        .then((keys) => {
          if (keys.length) ioRedis.del(...keys);
        })
        .catch(() => undefined);
    }
  } catch {}
}

// Live provider model catalogs change rarely (new model releases) but are
// fetched on every catalog/resolve call — cache them for 24h. Keyed by a hash
// of the credential material (never the raw key) so a credential change lands
// on a fresh key naturally and the stale one expires on its own.
const MODEL_LIST_TTL_SECONDS = 24 * 60 * 60;

function modelListCacheKey(
  domain: 'ai' | 'media',
  providerId: string,
  version: string,
  credentials: Record<string, string>,
  scope?: string,
): string {
  const hash = createHash('sha256')
    .update(`${credentials.apiKey ?? ''}|${credentials.baseURL ?? ''}`)
    .digest('hex')
    .slice(0, 16);
  // `scope` discriminates listings that vary per call for the same provider —
  // media listModels is per-operation (image/video/audio), so categories sharing
  // a provider must not poison each other's cache entry.
  return `providers:models:${domain}:${providerId}:${version}:${hash}${scope ? `:${scope}` : ''}`;
}

/**
 * Return the provider's model list, using a 24h Redis cache in front of the
 * (potentially live) `fetcher`. Only non-empty successful results are cached —
 * a transient upstream failure is retried on the next call. Redis failures are
 * best-effort: fall through to the fetcher rather than failing the request.
 */
export async function getOrCacheModelList<T>(
  domain: 'ai' | 'media',
  providerId: string,
  version: string,
  credentials: Record<string, string>,
  fetcher: () => Promise<T[] | undefined>,
  scope?: string,
): Promise<T[] | undefined> {
  const key = modelListCacheKey(domain, providerId, version, credentials, scope);
  try {
    const cached = await ioRedis.get(key);
    if (cached) {
      return JSON.parse(cached) as T[];
    }
  } catch {}
  const fresh = await fetcher();
  if (fresh && fresh.length > 0) {
    try {
      await ioRedis.set(key, JSON.stringify(fresh), 'EX', MODEL_LIST_TTL_SECONDS);
    } catch {}
  }
  return fresh;
}
