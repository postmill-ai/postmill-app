import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ProviderConfigService } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service';
import { replaceCredentialsMap, type CredentialEntry } from '@gitroom/nestjs-libraries/integrations/credentials';
import { ProviderConfiguration } from '@prisma/client';

// Cross-replica cache invalidation channel (A3). Other replicas clear/refresh
// their in-memory cache when a config write publishes here.
const PROVIDER_INVALIDATE_CHANNEL = 'config:invalidate:providers';

type DecryptedConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  additionalConfig?: string;
  setupInstructions?: string;
  enabled: boolean;
  name: string;
  identifier: string;
};

@Injectable()
export class ProviderConfigManager implements OnModuleInit, OnModuleDestroy {
  private readonly _logger = new Logger(ProviderConfigManager.name);
  private cache: Map<string, DecryptedConfig> = new Map();
  private allEnabled: string[] = [];
  private lastRefresh = 0;
  private refreshIntervalMs = 60_000;
  private refreshPromise: Promise<void> | null = null;
  // A3 — cross-replica invalidation. Unique per process so we skip our own publishes.
  private readonly _instanceId = randomUUID();
  private _subscriber: Redis | null = null;

  constructor(private _providerConfigService: ProviderConfigService) {}

  async onModuleInit() {
    this.#setupInvalidationSubscriber();
    try {
      // Internal refresh — no publish (boot must not broadcast to every replica).
      await this.#refreshInternal();
    } catch (err: any) {
      this._logger.error(`Failed to load provider configs on startup, will retry on first access: ${err?.message}`);
    }
  }

  async onModuleDestroy() {
    if (this._subscriber) {
      try {
        await this._subscriber.unsubscribe(PROVIDER_INVALIDATE_CHANNEL);
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
        if (channel !== PROVIDER_INVALIDATE_CHANNEL) return;
        if (message === this._instanceId) return; // ignore our own publish
        // Clear + force a refresh so the next read serves fresh config.
        this.lastRefresh = 0;
        this.#refreshInternal().catch((err: any) =>
          this._logger.error(`Invalidation refresh failed: ${err?.message}`),
        );
      });
      sub.subscribe(PROVIDER_INVALIDATE_CHANNEL).catch((err: any) => {
        this._subscriber = null;
        this._logger.error(`Failed to subscribe to ${PROVIDER_INVALIDATE_CHANNEL}: ${err?.message}`);
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
      await client.publish(PROVIDER_INVALIDATE_CHANNEL, this._instanceId);
    } catch (err: any) {
      this._logger.error(`Failed to publish cache invalidation: ${err?.message}`);
    }
  }

  // Local reload only (no broadcast) — used by boot, the TTL path, and inbound
  // invalidation messages.
  async #refreshInternal() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
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
    const configs = await this._providerConfigService.getAll();
    const newCache = new Map<string, DecryptedConfig>();
    const newEnabled: string[] = [];
    const newCredentials = new Map<string, CredentialEntry>();

    for (const config of configs) {
      try {
        const decrypted = this._providerConfigService.decryptConfig(config);
        const entry: DecryptedConfig = {
          identifier: config.identifier,
          name: config.name,
          enabled: config.enabled,
          clientId: decrypted.clientId,
          clientSecret: decrypted.clientSecret,
          redirectUri: config.redirectUri || undefined,
          scopes: config.scopes || undefined,
          additionalConfig: config.additionalConfig || undefined,
          setupInstructions: config.setupInstructions || undefined,
        };
        newCache.set(config.identifier, entry);
        if (config.enabled) {
          newEnabled.push(config.identifier);
        }

        let token: string | undefined;
        if (config.additionalConfig) {
          let parsed: Record<string, any> | undefined;
          try {
            parsed = JSON.parse(config.additionalConfig);
          } catch {
            this._logger.error(`Failed to parse additionalConfig for ${config.identifier}`);
          }
          if (parsed?.botToken) {
            token = AuthService.fixedDecryption(parsed.botToken);
          }
        }

        if (entry.enabled && (entry.clientId || entry.clientSecret || token)) {
          newCredentials.set(config.identifier, {
            clientId: entry.clientId,
            clientSecret: entry.clientSecret,
            redirectUri: entry.redirectUri,
            scopes: entry.scopes
              ? entry.scopes.split(',').map((s: string) => s.trim())
              : undefined,
            ...(token ? { token } : {}),
          });
        }
      } catch (err) {
        this._logger.error(`Failed to load config for ${config.identifier}: ${(err as any)?.message}`);
      }
    }

    this.cache = newCache;
    this.allEnabled = newEnabled;
    replaceCredentialsMap('__global__', newCredentials);
    this.lastRefresh = Date.now();
  }

  async ensureFresh() {
    if (Date.now() - this.lastRefresh > this.refreshIntervalMs) {
      try {
        // TTL reload is local-only — never publish (would storm across replicas).
        await this.#refreshInternal();
      } catch (err) {
        this._logger.error(`Cache refresh failed, will retry on next request: ${(err as any)?.message}`);
      }
    }
  }

  async getConfig(identifier: string): Promise<DecryptedConfig | undefined> {
    await this.ensureFresh();
    return this.cache.get(identifier);
  }

  async getEnabledIdentifiers(): Promise<string[]> {
    await this.ensureFresh();
    return [...this.allEnabled];
  }

  async getAllConfigs(): Promise<DecryptedConfig[]> {
    await this.ensureFresh();
    return Array.from(this.cache.values());
  }

  async isEnabled(identifier: string): Promise<boolean> {
    await this.ensureFresh();
    const config = this.cache.get(identifier);
    return config?.enabled === true;
  }

  async getClientInfo(identifier: string): Promise<{
    client_id: string;
    client_secret: string;
    instanceUrl: string;
    token?: string;
  } | undefined> {
    await this.ensureFresh();
    const config = this.cache.get(identifier);
    if (!config?.enabled) {
      return undefined;
    }
    let token: string | undefined;
    if (config.additionalConfig) {
      try {
        const parsed = JSON.parse(config.additionalConfig);
        if (parsed?.botToken) {
          token = AuthService.fixedDecryption(parsed.botToken);
        }
      } catch {}
    }
    if (!config.clientId && !config.clientSecret) {
      if (!token) return undefined;
    } else if (!config.clientId || !config.clientSecret) {
      return undefined;
    }
    return {
      client_id: config.clientId || '',
      client_secret: config.clientSecret || '',
      // redirectUri doubles as instanceUrl for self-hosted providers (Mastodon, etc.)
      instanceUrl: config.redirectUri || '',
      ...(token ? { token } : {}),
    };
  }
}
