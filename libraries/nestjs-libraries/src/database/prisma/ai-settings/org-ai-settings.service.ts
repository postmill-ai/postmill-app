import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { OrgAiSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { AIProviderAdapter } from '@gitroom/nestjs-libraries/ai/ai-provider.interface';
import { ProviderCredentialLinkService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/provider-credential-link.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel, DEFAULT_VERSION } from '@gitroom/provider-kernel';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { bustDefaultsCatalogCache } from '@gitroom/nestjs-libraries/ai/defaults/defaults-cache';
import { DefaultsSeedService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-seed.service';

@Injectable()
export class OrgAiSettingsService {
  private readonly _logger = new Logger(OrgAiSettingsService.name);

  constructor(
    private _repository: OrgAiSettingsRepository,
    private _encryption: EncryptionService,
    private _resolution: ProviderResolutionService,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    @Inject(forwardRef(() => DefaultsSeedService))
    private _defaultsSeed: DefaultsSeedService,
    @Optional() private _credentialLink?: ProviderCredentialLinkService,
  ) {}

  // Resolve a single AI adapter through the ProviderKernel; null for an
  // unknown/unregistered provider (mirrors the old registry.getAdapter).
  private _resolveAdapter(identifier: string, version?: string): AIProviderAdapter | null {
    try {
      return this._resolution.resolveAI(identifier, version ? { version } : {});
    } catch {
      return null;
    }
  }

  // Enumerate the registered AI adapters (one per provider id, latest registered
  // manifest wins) — replaces the legacy in-memory registry enumeration.
  private _listAdapters(): AIProviderAdapter[] {
    const seen = new Set<string>();
    const adapters: AIProviderAdapter[] = [];
    for (const manifest of this._kernel.listManifests('ai')) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      const adapter = this._resolveAdapter(manifest.providerId, manifest.version);
      if (adapter) adapters.push(adapter);
    }
    return adapters;
  }

  async getProviders(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    const adapters = this._listAdapters();

    return adapters.map((adapter) => {
      const dbConfig = configs.find((c) => c.identifier === adapter.identifier);
      const isConfigured = this._isConfigured(adapter, dbConfig);
      return {
        identifier: adapter.identifier,
        name: adapter.name,
        type: adapter.type,
        capabilities: adapter.capabilities,
        credentialFields: adapter.credentialFields,
        enabled: dbConfig?.enabled || false,
        isActive: dbConfig?.isActive || false,
        isConfigured,
        defaultModel: dbConfig?.defaultModel || '',
        reasoningModel: dbConfig?.reasoningModel || '',
        version: dbConfig?.version ?? 'v1',
        createdAt: dbConfig?.createdAt || null,
        updatedAt: dbConfig?.updatedAt || null,
      };
    });
  }

  async getActiveProvider(orgId: string) {
    const config = await this._repository.getActive(orgId);
    if (!config) return null;

    const adapter = this._resolveAdapter(config.identifier, config.version ?? 'v1');
    if (!adapter) return null;

    const decrypted = this._decryptCredentials(config.credentials);
    return {
      identifier: config.identifier,
      version: config.version ?? 'v1',
      name: adapter.name,
      type: adapter.type,
      capabilities: adapter.capabilities,
      credentialFields: adapter.credentialFields,
      enabled: config.enabled,
      isActive: config.isActive,
      defaultModel: config.defaultModel,
      reasoningModel: config.reasoningModel,
      credentials: decrypted,
    };
  }

  async getByIdentifier(orgId: string, identifier: string, version?: string) {
    const resolvedVersion = this._resolveVersion(identifier, version);
    const config = await this._repository.getByIdentifier(orgId, identifier, resolvedVersion);
    if (!config) return null;

    const adapter = this._resolveAdapter(identifier, resolvedVersion);
    if (!adapter) return null;

    const decrypted = this._decryptCredentials(config.credentials);
    return {
      identifier: config.identifier,
      version: config.version ?? 'v1',
      name: adapter.name,
      type: adapter.type,
      capabilities: adapter.capabilities,
      credentialFields: adapter.credentialFields,
      enabled: config.enabled,
      isActive: config.isActive,
      defaultModel: config.defaultModel || '',
      reasoningModel: config.reasoningModel || '',
      credentials: decrypted,
    };
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      isActive?: boolean;
      credentials?: Record<string, string>;
      defaultModel?: string;
      reasoningModel?: string;
      extraConfig?: Record<string, unknown> | string;
      version?: string;
    },
  ) {
    const adapter = this._resolveAdapter(identifier, data.version);
    if (!adapter) {
      throw new BadRequestException('Unknown provider');
    }

    await this._assertBaseURLSafe(data.credentials?.baseURL);

    const { version: requestedVersion, ...payload } = data;
    // 1.1: validate the (client-supplied or defaulted) version against the
    // lifecycle before pinning — a deprecated version rejects the write (400), a
    // retired version is 410, an unknown version is 400. Persist the resolved
    // version rather than the unvalidated client string.
    const version = this._resolution.resolveWriteVersion('ai', identifier, requestedVersion);

    // §3.5 — capture BEFORE the write whether this org has any provider configured yet.
    // Only a first-time setup (the org's very first provider) auto-activates below, so the
    // normal Settings flow on an established org (any existing config, active or not) is never
    // touched — otherwise re-saving credentials could silently flip AI on and start billing
    // the org's key.
    const isFirstProvider =
      !!payload.credentials && (await this._repository.getByOrg(orgId)).length === 0;

    const encryptedCredentials = payload.credentials
      ? this._encryption.encrypt(JSON.stringify(payload.credentials))
      : undefined;

    const extraConfig = payload.extraConfig
      ? (typeof payload.extraConfig === 'string' ? payload.extraConfig : JSON.stringify(payload.extraConfig))
      : undefined;

    const result = await this._repository.upsert(orgId, identifier, {
      ...payload,
      credentials: encryptedCredentials,
      extraConfig,
    }, version);

    // §11.4 auto-config: OpenAI/MiniMax AI credentials live-link to the media surface.
    if (data.credentials && this._credentialLink) {
      await this._credentialLink.syncFromAiProvider(orgId, identifier, data.credentials);
    }

    // 1.3a: drop the cached capability so the next resolve rebuilds with the
    // freshly-written credentials/config rather than a stale closure.
    this._resolution.invalidate('ai', identifier, orgId);

    // §3.5 auto-activate the org's first-ever LLM provider on save so the setup wizard's
    // step-1 gate clears without a separate "Make Primary" click. Scoped to a first-time
    // setup (see isFirstProvider above); an established org is never auto-activated.
    if (isFirstProvider && payload.credentials) {
      if (this._hasRequiredCredentials(adapter, payload.credentials)) {
        try {
          await this.setActive(orgId, identifier, version);
        } catch (err) {
          this._logger.warn(`Auto-activation of first LLM provider "${identifier}" failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Eagerly seed any unset model/media defaults now that a provider is available.
    // Intentionally detached + non-fatal: seeding must never delay or fail the provider
    // config response.
    this._defaultsSeed.seedUnset(orgId).catch(() => undefined);
    bustDefaultsCatalogCache(orgId);

    return result;
  }

  async setActive(orgId: string, identifier: string, version?: string) {
    const resolvedVersion = this._resolveVersion(identifier, version);
    const config = await this._repository.getByIdentifier(orgId, identifier, resolvedVersion);
    if (!config) {
      throw new Error(`Provider "${identifier}" not configured for this organization`);
    }

    const adapter = this._resolveAdapter(identifier, resolvedVersion);
    if (!adapter) {
      throw new Error(`Unknown provider: ${identifier}`);
    }

    const decrypted = this._decryptCredentials(config.credentials);
    if (!this._hasRequiredCredentials(adapter, decrypted)) {
      throw new Error(`Provider "${identifier}" is not fully configured. Fill in all required credential fields first.`);
    }

    const result = await this._repository.setActive(orgId, identifier, resolvedVersion);

    // Eagerly seed any unset model/media defaults now that the active provider changed.
    this._defaultsSeed.seedUnset(orgId).catch(() => undefined);
    bustDefaultsCatalogCache(orgId);

    return result;
  }

  async delete(orgId: string, identifier: string) {
    // 1.4: delete the actually-pinned row, not a hardcoded v1 — otherwise a
    // config pinned to a later version 404s the delete (Prisma P2025 → 500) and
    // orphans the row.
    const version = await this._getPinnedVersion(orgId, identifier);
    const result = await this._repository.delete(orgId, identifier, version);
    // 1.3a: evict the cached capability for the deleted config.
    this._resolution.invalidate('ai', identifier, orgId);
    bustDefaultsCatalogCache(orgId);
    return result;
  }

  async testConnection(
    orgId: string,
    identifier: string,
    credentials?: Record<string, string>,
  ) {
    const adapter = this._resolveAdapter(identifier);
    if (!adapter) {
      throw new BadRequestException('Unknown provider');
    }

    if (credentials) {
      await this._assertBaseURLSafe(credentials.baseURL);
      return adapter.validateCredentials(credentials);
    }

    // 1.4: resolve the pinned version so the test operates on the same row a
    // read would (stored row's version, else latest-active).
    const version = await this._getPinnedVersion(orgId, identifier);
    const config = await this._repository.getByIdentifier(orgId, identifier, version);
    if (!config) {
      throw new Error(`Provider "${identifier}" not configured for this organization`);
    }

    const decrypted = this._decryptCredentials(config.credentials);
    await this._assertBaseURLSafe(decrypted.baseURL);
    return adapter.validateCredentials(decrypted);
  }

  async getBudget(orgId: string) {
    return this._repository.getBudget(orgId);
  }

  async updateBudget(orgId: string, data: {
    monthlyCap?: number;
    dailyCap?: number;
    alertThresholdPct?: number;
    enabled?: boolean;
  }) {
    return this._repository.upsertBudget(orgId, data);
  }

  private async _assertBaseURLSafe(baseURL: string | undefined) {
    if (typeof baseURL !== 'string' || !baseURL.trim()) return;
    const safe = await isSafePublicHttpsUrl(baseURL);
    if (!safe) {
      throw new BadRequestException(
        'Base URL must be a public HTTPS URL (private, loopback, and non-HTTPS hosts are not allowed)',
      );
    }
  }

  private _resolveVersion(identifier: string, version?: string): string {
    if (version) return version;
    const latest = this._kernel.latestActive('ai', identifier);
    return latest?.manifest.version ?? DEFAULT_VERSION;
  }

  // 1.4: the version an org's row is pinned to — the stored row's version, else
  // the latest active version, else the default. Mirrors
  // OrgShortLinkSettingsService.getPinnedVersion (the reference implementation).
  private async _getPinnedVersion(orgId: string, identifier: string): Promise<string> {
    // 1.2: version-AGNOSTIC read — `getByIdentifier` findUnique-defaults to v1, so
    // a config pinned to v2 would return null and wrongly fall through to
    // latestActive (resolving the wrong row, reading empty creds, deleting the
    // wrong row). Use the newest-row-any-version read instead.
    const config = await this._repository.findAnyByIdentifier(orgId, identifier);
    return (
      config?.version ??
      this._resolution.latestActiveVersion('ai', identifier) ??
      DEFAULT_VERSION
    );
  }

  private _decryptCredentials(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(this._encryption.decrypt(encrypted));
    } catch {
      this._logger.warn('Failed to decrypt provider credentials');
      return {};
    }
  }

  private _isConfigured(adapter: { credentialFields: { key: string; required: boolean }[] }, config: { credentials?: string | null; enabled?: boolean } | undefined): boolean {
    if (!config) return false;
    const decrypted = this._decryptCredentials(config.credentials);
    return this._hasRequiredCredentials(adapter, decrypted);
  }

  private _hasRequiredCredentials(
    adapter: { credentialFields: { key: string; required: boolean }[] },
    credentials: Record<string, string>,
  ): boolean {
    return adapter.credentialFields
      .filter((f) => f.required)
      .every((f) => {
        const value = credentials[f.key];
        return typeof value === 'string' && value.trim().length > 0;
      });
  }
}
