import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  parseQualified,
  qualify,
  DEFAULT_VERSION,
} from '@gitroom/provider-kernel';

// Cross-replica cache invalidation channel (A3).
const AI_INVALIDATE_CHANNEL = 'config:invalidate:ai';

export function normalizeProviderId(
  value: string | null | undefined,
): string | null {
  if (!value) return value ?? null;
  const { providerId } = parseQualified(value);
  return providerId || value;
}

export function qualifyProviderId(
  value: string | null | undefined,
): string | null {
  if (!value) return value ?? null;
  const { providerId } = parseQualified(value);
  if (!providerId) return value;
  return qualify(providerId);
}

export function ensureScopeModelsVersion(scopeModels: any): any {
  if (
    !scopeModels ||
    typeof scopeModels !== 'object' ||
    Array.isArray(scopeModels)
  ) {
    return scopeModels;
  }

  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(scopeModels)) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      out[key] = { version: DEFAULT_VERSION, ...(entry as Record<string, any>) };
    } else {
      out[key] = entry;
    }
  }
  return out;
}

interface CachedSettings {
  id: string;
  activeProvider: string | null;
  activeModel: string | null;
  scopeModels: string | null;
  fallbackProvider: string | null;
  fallbackImageProvider: string | null;
  guardrailSettings: string | null;
  budgetSettings: string | null;
  rateLimitSettings: string | null;
  observability: string | null;
  mcpSettings: string | null;
  ragSettings: string | null;
  cacheSettings: string | null;
  routingSettings: string | null;
  secretSettings: string | null;
  updatedAt: Date;
}

export interface AiSettingsResult {
  id: string;
  activeProvider: string | null;
  activeModel: string | null;
  scopeModels: any;
  fallbackProvider: string | null;
  fallbackImageProvider: string | null;
  guardrailSettings: any;
  budgetSettings: any;
  rateLimitSettings: any;
  observability: any;
  mcpSettings: any;
  ragSettings: any;
  cacheSettings: any;
  routingSettings: any;
  secretSettings: Record<string, string> | undefined;
  updatedAt: Date;
}

@Injectable()
export class AiSettingsManager implements OnModuleInit, OnModuleDestroy {
  private readonly _logger = new Logger(AiSettingsManager.name);
  private cache: CachedSettings | null = null;
  private lastRefresh = 0;
  private readonly refreshIntervalMs = 60_000;
  private refreshPromise: Promise<void> | null = null;
  // A3 — cross-replica invalidation. Unique per process so we skip our own publishes.
  private readonly _instanceId = randomUUID();
  private _subscriber: Redis | null = null;

  constructor(private _aiSettingsService: AiSettingsService) {}

  async onModuleInit() {
    this.#setupInvalidationSubscriber();
    try {
      // Internal refresh — no publish (boot must not broadcast to every replica).
      await this.#refreshInternal();
    } catch (err: any) {
      this._logger.error('Failed to load AI settings on startup, will retry on first access:', err?.message);
    }
  }

  async onModuleDestroy() {
    if (this._subscriber) {
      try {
        await this._subscriber.unsubscribe(AI_INVALIDATE_CHANNEL);
        await this._subscriber.quit();
      } catch {
        // best-effort teardown
      }
      this._subscriber = null;
    }
  }

  // Subscribes (on a DUPLICATED connection — never the shared client) to the
  // invalidation channel. No-op on MockRedis / no Redis: the 60s TTL refresh
  // remains the single-instance fallback and behaviour is unchanged.
  #setupInvalidationSubscriber() {
    if (this._subscriber) return; // guard double-subscribe
    const client = ioRedis as any;
    if (!client || typeof client.duplicate !== 'function') {
      return; // MockRedis (no REDIS_URL) — TTL fallback only
    }
    try {
      const sub: Redis = client.duplicate();
      this._subscriber = sub;
      sub.on('message', (channel: string, message: string) => {
        if (channel !== AI_INVALIDATE_CHANNEL) return;
        if (message === this._instanceId) return; // ignore our own publish
        // Clear + force a refresh so the next read serves fresh settings.
        this.lastRefresh = 0;
        this.#refreshInternal().catch((err: any) =>
          this._logger.error(`Invalidation refresh failed: ${err?.message}`),
        );
      });
      sub.subscribe(AI_INVALIDATE_CHANNEL).catch((err: any) => {
        this._subscriber = null;
        this._logger.error(`Failed to subscribe to ${AI_INVALIDATE_CHANNEL}: ${err?.message}`);
      });
    } catch (err: any) {
      this._subscriber = null;
      this._logger.error(`Failed to set up invalidation subscriber: ${err?.message}`);
    }
  }

  // PUBLISH on the shared client (non-blocking command — safe per the Redis
  // invariant; only SUBSCRIBE/blocking calls are forbidden on the shared client).
  async publishInvalidate() {
    const client = ioRedis as any;
    if (!client || typeof client.publish !== 'function') {
      return; // MockRedis / no Redis — single instance, nothing to invalidate
    }
    try {
      await client.publish(AI_INVALIDATE_CHANNEL, this._instanceId);
    } catch (err: any) {
      this._logger.error(`Failed to publish cache invalidation: ${err?.message}`);
    }
  }

  // Local reload only (no broadcast) — used by boot, the TTL path, and inbound
  // invalidation messages.
  async #refreshInternal() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.#doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  // Public write-path refresh: reloads the local cache AND notifies other
  // replicas to bust theirs immediately. Every external caller is a config
  // write path, so the invalidation rides along automatically.
  async refreshCache() {
    await this.#refreshInternal();
    await this.publishInvalidate();
  }

  async #doRefresh() {
    const settings = await this._aiSettingsService.getSystemSettings();
    this.cache = settings;
    this.lastRefresh = Date.now();
  }

  async ensureFresh() {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs) {
      try {
        // TTL reload is local-only — never publish (would storm across replicas).
        await this.#refreshInternal();
      } catch (err) {
        this._logger.error('AiSettingsManager: Cache refresh failed, will retry on next request', err);
      }
    }
  }

  async getSettings(): Promise<AiSettingsResult | null> {
    await this.ensureFresh();
    if (!this.cache) return null;

    const settings = this.cache;
    let secretSettings: Record<string, string> | undefined;
    if (settings.secretSettings) {
      try {
        secretSettings = JSON.parse(
          AuthService.fixedDecryption(settings.secretSettings),
        );
      } catch {
        secretSettings = undefined;
      }
    }

    const parsed: any = { ...settings, secretSettings };
    for (const field of ['scopeModels', 'guardrailSettings', 'budgetSettings', 'rateLimitSettings', 'observability', 'mcpSettings', 'ragSettings', 'cacheSettings', 'routingSettings']) {
      if (typeof parsed[field] === 'string') {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch {
          // leave as-is
        }
      }
    }

    parsed.activeProvider = normalizeProviderId(parsed.activeProvider);
    parsed.fallbackProvider = normalizeProviderId(parsed.fallbackProvider);
    parsed.fallbackImageProvider = normalizeProviderId(
      parsed.fallbackImageProvider,
    );
    parsed.scopeModels = ensureScopeModelsVersion(parsed.scopeModels);

    return parsed;
  }

  /**
   * Checks whether at least one org has configured an active AI provider
   * (or if global settings still have an activeProvider from a previous admin setup).
   */
  hasActiveConfig(): boolean {
    this.ensureFresh().catch(() => {});
    return !!(this.cache?.activeProvider);
  }

  async hasActiveConfigAsync(): Promise<boolean> {
    await this.ensureFresh();
    return !!(this.cache?.activeProvider);
  }
}
