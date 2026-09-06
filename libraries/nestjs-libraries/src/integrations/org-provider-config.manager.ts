import { Injectable } from '@nestjs/common';
import { OrgProviderConfigService } from '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/org-provider-config.service';
import { replaceCredentialsMap, clearOrgCredentials, type CredentialEntry } from '@postmill-ai/nestjs-libraries/integrations/credentials';
import { CHANNEL_ENV_MAPPINGS, getEnvClientInfo } from '@postmill-ai/nestjs-libraries/integrations/channel-env-credentials';

type DecryptedConfig = {
  id: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  additionalConfig?: string;
  setupNotes?: string;
  enabled: boolean;
  name: string;
  identifier: string;
  version?: string;
};

type OrgCache = {
  // Keyed by config id — the authoritative per-instance map.
  byId: Map<string, DecryptedConfig>;
  // Keyed by provider identifier — the "primary" config (enabled-first) used by
  // legacy by-identifier resolution / fallback for unbound integrations.
  configs: Map<string, DecryptedConfig>;
  enabledIdentifiers: string[];
  lastRefresh: number;
  refreshPromise: Promise<void> | null;
};

const REFRESH_INTERVAL_MS = 60_000;

@Injectable()
export class OrgProviderConfigManager {
  private orgCaches = new Map<string, OrgCache>();

  constructor(private _orgProviderConfigService: OrgProviderConfigService) {}

  async ensureFresh(orgId: string) {
    let cache = this.orgCaches.get(orgId);
    if (!cache) {
      cache = { byId: new Map(), configs: new Map(), enabledIdentifiers: [], lastRefresh: 0, refreshPromise: null };
      this.orgCaches.set(orgId, cache);
    }

    if (Date.now() - cache.lastRefresh <= REFRESH_INTERVAL_MS) return;
    if (cache.refreshPromise) {
      await cache.refreshPromise;
      return;
    }

    cache.refreshPromise = this.#doRefresh(orgId, cache);
    try {
      await cache.refreshPromise;
    } finally {
      cache.refreshPromise = null;
    }
  }

  async #doRefresh(orgId: string, cache: OrgCache) {
    const newById = new Map<string, DecryptedConfig>();
    const newByIdentifier = new Map<string, DecryptedConfig>();
    const newEnabled = new Set<string>();
    const newCredentials = new Map<string, CredentialEntry>();

    const allConfigs = await this._orgProviderConfigService.getDecryptedConfigs(orgId);

    for (const config of allConfigs) {
      const entry: DecryptedConfig = {
        id: config.id,
        identifier: config.identifier,
        name: config.name,
        enabled: config.enabled,
        version: config.version,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
        scopes: config.scopes,
        additionalConfig: config.additionalConfig,
        setupNotes: config.setupNotes,
      };
      newById.set(config.id, entry);

      // Primary per identifier: prefer an enabled config over a disabled one.
      const current = newByIdentifier.get(config.identifier);
      if (!current || (entry.enabled && !current.enabled)) {
        newByIdentifier.set(config.identifier, entry);
      }

      if (config.enabled && (config.clientId || config.clientSecret)) {
        newEnabled.add(config.identifier);
      }
    }

    // Credentials map is keyed by identifier (the publish path resolves by identifier
    // when an integration isn't bound to a specific config) — use the primary.
    for (const [identifier, entry] of newByIdentifier) {
      if (entry.enabled && (entry.clientId || entry.clientSecret)) {
        // Discord's guild channel list/posting authenticates with the bot token
        // stored in additionalConfig.botToken — surface it to getOrgCredential.
        let botToken: string | undefined;
        try {
          botToken = entry.additionalConfig
            ? JSON.parse(entry.additionalConfig)?.botToken
            : undefined;
        } catch {
          // Tolerate unparseable additionalConfig — token stays undefined.
        }
        newCredentials.set(identifier, {
          clientId: entry.clientId,
          clientSecret: entry.clientSecret,
          redirectUri: entry.redirectUri,
          scopes: entry.scopes?.split(',').map((s: string) => s.trim()),
          ...(botToken ? { token: botToken } : {}),
        });
      }
    }

    // Fill gaps from the platform env app: plug methods (e.g. Discord's guild
    // channel list) read this cache via getOrgCredential, and an org using the
    // click-connect platform app has NO org config row to draw from. Org configs
    // always win over env for the same identifier.
    for (const mapping of CHANNEL_ENV_MAPPINGS) {
      if (newCredentials.has(mapping.identifier)) continue;
      const envInfo = getEnvClientInfo(mapping.identifier);
      if (envInfo) {
        newCredentials.set(mapping.identifier, {
          clientId: envInfo.client_id,
          clientSecret: envInfo.client_secret,
          token: envInfo.token,
        });
      }
    }

    cache.byId = newById;
    cache.configs = newByIdentifier;
    cache.enabledIdentifiers = [...newEnabled];
    cache.lastRefresh = Date.now();

    replaceCredentialsMap(orgId, newCredentials);
  }

  invalidateOrg(orgId: string) {
    this.orgCaches.delete(orgId);
    clearOrgCredentials(orgId);
  }

  async getConfig(orgId: string, identifier: string): Promise<DecryptedConfig | undefined> {
    await this.ensureFresh(orgId);
    return this.orgCaches.get(orgId)?.configs.get(identifier);
  }

  async getConfigById(orgId: string, configId: string): Promise<DecryptedConfig | undefined> {
    await this.ensureFresh(orgId);
    return this.orgCaches.get(orgId)?.byId.get(configId);
  }

  async getEnabledIdentifiers(orgId: string): Promise<string[]> {
    await this.ensureFresh(orgId);
    return [...(this.orgCaches.get(orgId)?.enabledIdentifiers || [])];
  }

  async getAllConfigs(orgId: string): Promise<DecryptedConfig[]> {
    await this.ensureFresh(orgId);
    return Array.from(this.orgCaches.get(orgId)?.configs.values() || []);
  }

  async isEnabled(orgId: string, identifier: string): Promise<boolean> {
    await this.ensureFresh(orgId);
    return this.orgCaches.get(orgId)?.configs.get(identifier)?.enabled === true;
  }

  #buildClientInfo(config: DecryptedConfig | undefined, requireEnabled: boolean) {
    if (!config) return undefined;
    if (requireEnabled && !config.enabled) return undefined;

    // additionalConfig arrives already decrypted (whole-blob, see
    // OrgProviderConfigService.getDecryptedConfigs) — values inside the parsed
    // JSON are plaintext, unlike the platform-level ProviderConfigManager.
    let token: string | undefined;
    let configId: string | undefined;
    if (config.additionalConfig) {
      try {
        const parsed = JSON.parse(config.additionalConfig);
        if (parsed?.botToken) {
          token = parsed.botToken;
        }
        // Meta "Facebook Login for Business" configuration id (facebook /
        // instagram channels) — switches the OAuth dialog to config_id.
        if (parsed?.configId) {
          configId = parsed.configId;
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
      instanceUrl: config.redirectUri || '',
      ...(token ? { token } : {}),
      ...(configId ? { configId } : {}),
    };
  }

  async getClientInfo(orgId: string, identifier: string): Promise<{
    client_id: string;
    client_secret: string;
    instanceUrl: string;
    token?: string;
    configId?: string;
  } | undefined> {
    await this.ensureFresh(orgId);
    return this.#buildClientInfo(this.orgCaches.get(orgId)?.configs.get(identifier), true);
  }

  // Resolve credentials for a specific named config (each named set uses its own auth).
  async getClientInfoById(orgId: string, configId: string): Promise<{
    client_id: string;
    client_secret: string;
    instanceUrl: string;
    token?: string;
    configId?: string;
  } | undefined> {
    await this.ensureFresh(orgId);
    return this.#buildClientInfo(this.orgCaches.get(orgId)?.byId.get(configId), false);
  }
}
