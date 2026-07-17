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
