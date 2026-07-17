import { forwardRef, Injectable, Logger, Optional, Inject, HttpException } from '@nestjs/common';
import { OrgMediaProviderSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel } from '@gitroom/provider-kernel';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { DefaultsSeedService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-seed.service';
import { ProviderCredentialLinkService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/provider-credential-link.service';
import { OrgAiSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.repository';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { MediaProviderAdapter } from '@gitroom/nestjs-libraries/media/media-provider-adapter.interface';

const STANDARD_FOLDERS = ['documents', 'audio', 'images', 'video', 'other'];

// Providers whose media credential is the SAME key as their AI/LLM provider (Qwen on
// DashScope). When no dedicated media credential exists, fall back to the org's AI
// provider key — configure once, works for both surfaces. (openai/minimax instead
// write-mirror both ways via ProviderCredentialLinkService; Qwen has no media-side
// settings flow yet, so a read-fallback is the lighter, immediate path.)
const UNIVERSAL_AI_CREDENTIAL = new Set([
  'qwen',
  'google',
  'togetherai',
  'siliconflow',
  'groq',
  'openrouter',
  'fireworks',
  'deepinfra',
  'gateway',
  'bedrock',
  'azure',
  'xai',
]);

export interface MediaProviderExtraConfig {
  operations?: string[];
  c2paAvailable?: boolean;
}

export interface EnabledMediaProvider {
  identifier: string;
  storageProviderId: string | null;
  storageRootFolderId: string | null;
  extraConfig: MediaProviderExtraConfig;
}

@Injectable()
export class OrgMediaProviderSettingsService {
  private readonly _logger = new Logger(OrgMediaProviderSettingsService.name);

  constructor(
    private _repository: OrgMediaProviderSettingsRepository,
    private _encryption: EncryptionService,
    private _resolution: ProviderResolutionService,
    private _fileService: FileService,
    private _storageService: StorageService,
    @Inject(forwardRef(() => DefaultsSeedService))
    private _defaultsSeed: DefaultsSeedService,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
    @Optional() private _credentialLink?: ProviderCredentialLinkService,
    // layering: sanctioned leaf-read of OrgAiSettingsRepository (OrgAiSettingsService
    // imports ProviderCredentialLinkService from media-providers → routing up would cycle)
    @Optional() private _orgAiRepository?: OrgAiSettingsRepository,
  ) {}

  // Enumerate the registered media providers (one entry per provider id) from the
  // ProviderKernel — replaces the legacy in-memory registry enumeration.
  private _listProviders(): { identifier: string; name: string; capabilities: Record<string, boolean> }[] {
    const seen = new Set<string>();
    const out: { identifier: string; name: string; capabilities: Record<string, boolean> }[] = [];
    for (const manifest of this._kernel.listManifests('media')) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      out.push({
        identifier: manifest.providerId,
        name: manifest.displayName,
        capabilities: manifest.capabilities as Record<string, boolean>,
      });
    }
    return out;
  }

  // Resolve a media adapter through the kernel; throws when the provider is unknown.
  private _requireAdapter(identifier: string): MediaProviderAdapter {
    try {
      return this._resolution.resolveMedia(identifier);
    } catch {
      throw new HttpException('Unknown media provider', 400);
    }
  }

  /**
   * Resolve a media adapter for an inline connection test. Returns null for an
   * unknown provider so the controller can map to its preferred status code.
   */
  testConnectionAdapter(identifier: string): MediaProviderAdapter | null {
    try {
      return this._resolution.resolveMedia(identifier);
    } catch {
      return null;
    }
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

  private async _assertStorageOwnership(
    orgId: string,
    storageProviderId: string,
    storageRootFolderId?: string,
  ): Promise<void> {
    // `getProviderConfigs` is org-scoped (findByOrg) and includes the synthetic
    // `__virtual_local__` id for the default local provider.
    const configs = await this._storageService.getProviderConfigs(orgId);
    if (!configs.some((c) => c.id === storageProviderId)) {
      throw new HttpException(
        'storageProviderId does not belong to this organization',
        400,
      );
    }

    if (storageRootFolderId) {
      // `getFolder` throws (404) when the folder is missing or owned by another org;
      // normalise that (and only that) to a 400 for a bad write payload. A non-404
      // infra failure (DB outage, transient Prisma error) must propagate as 5xx —
      // it is not the user's bad input.
      try {
        await this._fileService.getFolder(orgId, storageRootFolderId);
      } catch (err) {
        // `getFolder` throws `HttpException('Folder not found', 404)` for the
        // ownership/not-found case; anything else is infra and must propagate.
        if (!(err instanceof HttpException) || err.getStatus() !== 404) throw err;
        throw new HttpException(
          'storageRootFolderId does not belong to this organization',
          400,
        );
      }
    }
  }

  /**
   * Static catalog metadata for every registered media provider.
   */
  listProviderMetadata() {
    const seen = new Set<string>();
    const out: {
      identifier: string;
      name: string;
      capabilities: unknown;
      credentialFields: unknown;
    }[] = [];
    for (const manifest of this._kernel.listManifests('media')) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      out.push({
        identifier: manifest.providerId,
        name: manifest.displayName,
        capabilities: manifest.capabilities,
        credentialFields: manifest.credentialFields ?? null,
      });
    }
    return out;
  }

  /**
   * Upsert a media provider config with SSRF validation on baseURL and cache
   * invalidation for the media-defaults catalog.
   */
  async upsertConfig(
    orgId: string,
    identifier: string,
    data: {
      credentials?: Record<string, string>;
      version?: string;
      enabled?: boolean;
    },
  ) {
    this._requireAdapter(identifier);

    // 3.2 (review): the same write-time SSRF gate as the AI settings route. For
    // openai/minimax these credentials are MIRRORED verbatim into the org's
    // AIOrgProviderConfig (§11.4 live-link), where a private `baseURL` would be
    // fetched by the AI-SDK's global dispatcher — the exact hole 3.2 closed on
    // the AI route must not stay open through the media side door.
    const baseURL = data.credentials?.baseURL;
    if (
      typeof baseURL === 'string' &&
      baseURL.trim() &&
      !(await isSafePublicHttpsUrl(baseURL))
    ) {
      throw new HttpException(
        'Base URL must be a public HTTPS URL (private, loopback, and non-HTTPS hosts are not allowed)',
        400,
      );
    }

    // OpenAI/MiniMax credentials live-link to the AI surface inside the service (§11.4).
    // `enabled` defaults to true (configuring enables); the kit's On/Off toggle sends
    // an explicit `{ enabled: false }` with no credentials to disable without clearing them.
    await this.upsert(orgId, identifier, {
      enabled: data.enabled ?? true,
      credentials: data.credentials,
      version: data.version,
    });

    // Eagerly seed any unset model/media defaults now that a media provider is available.
    this._defaultsSeed.seedUnset(orgId).catch(() => undefined);
    this._bustDefaultsCatalogCache(orgId);

    return { identifier, success: true };
  }

  /**
   * Bind a media provider to a storage provider + root folder, validating
   * org ownership of both before writing.
   */
  async setStorage(
    orgId: string,
    identifier: string,
    data: {
      storageProviderId: string;
      storageRootFolderId?: string;
    },
  ) {
    this._requireAdapter(identifier);

    // PROVIDER_REMEDIATION 3.6: validate the storage provider + root folder belong to
    // this org at WRITE time. Cross-org use is otherwise blocked only at job completion
    // (no leak, but the failure is deferred until after a paid render).
    await this._assertStorageOwnership(
      orgId,
      data.storageProviderId,
      data.storageRootFolderId,
    );

    await this.upsert(orgId, identifier, {
      storageProviderId: data.storageProviderId,
      storageRootFolderId: data.storageRootFolderId,
    });

    this._bustDefaultsCatalogCache(orgId);
    return { identifier, success: true };
  }

  /**
   * Mark a provider Primary and invalidate the media-defaults catalog cache.
   */
  async setActiveWithDefaults(
    orgId: string,
    identifier: string,
    version?: string,
  ) {
    this._requireAdapter(identifier);

    const result = await this.setActive(orgId, identifier, version);

    // Eagerly seed any unset model/media defaults now that the primary media provider changed.
    this._defaultsSeed.seedUnset(orgId).catch(() => undefined);
    this._bustDefaultsCatalogCache(orgId);

    return { identifier, success: true, isActive: result.isActive };
  }

  /**
   * Delete a media config and invalidate the media-defaults catalog cache.
   */
  async deleteConfig(orgId: string, identifier: string) {
    await this.delete(orgId, identifier);
    this._bustDefaultsCatalogCache(orgId);
    return { success: true };
  }

  async getProviders(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    const adapters = this._listProviders();
    // Universal-credential providers (Qwen) count as configured/active when the org has
    // the matching AI provider key, even without a dedicated media credential row.
    const universalConfigured = await this._universalAiConfigured(orgId, adapters);
    return adapters.map((adapter) => {
      const dbConfig = configs.find((c) => c.identifier === adapter.identifier);
      const inherited = universalConfigured.has(adapter.identifier);
      return {
        identifier: adapter.identifier,
        name: adapter.name,
        capabilities: adapter.capabilities,
        // 1.7: an explicit media row's `enabled` flag wins over the universal
        // AI-key inheritance — a deliberately-disabled (`enabled:false`) universal
        // provider must NOT read back as enabled just because the org has the AI key.
        enabled: dbConfig ? !!dbConfig.enabled : inherited,
        isActive: dbConfig?.isActive || false,
        isConfigured: !!dbConfig?.credentials || inherited,
        storageProviderId: dbConfig?.storageProviderId || null,
        storageRootFolderId: dbConfig?.storageRootFolderId || null,
        version: dbConfig?.version ?? 'v1',
        createdAt: dbConfig?.createdAt || null,
        updatedAt: dbConfig?.updatedAt || null,
      };
    });
  }

  async getActiveProviders(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    return configs
      .filter((c) => c.enabled && c.credentials)
      .map((c) => ({
        identifier: c.identifier,
        storageProviderId: c.storageProviderId,
        storageRootFolderId: c.storageRootFolderId,
      }));
  }

  // Org-enabled, credentialed providers with their parsed extraConfig (no secrets) —
  // the capability-driven resolution + the 4F summary read this.
  async getEnabledProviders(orgId: string): Promise<EnabledMediaProvider[]> {
    const configs = await this._repository.getByOrg(orgId);
    return configs
      .filter((c) => c.enabled && c.credentials)
      .map((c) => ({
        identifier: c.identifier,
        storageProviderId: c.storageProviderId ?? null,
        storageRootFolderId: c.storageRootFolderId ?? null,
        extraConfig: this._parseExtraConfig(c.extraConfig),
      }));
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      credentials?: Record<string, string>;
      storageProviderId?: string;
      storageRootFolderId?: string;
      version?: string;
    },
  ) {
    const encryptedCredentials = data.credentials
      ? this._encryption.encrypt(JSON.stringify(data.credentials))
      : undefined;

    // 1.1: validate the (client-supplied or defaulted) version against the
    // lifecycle before pinning (deprecated → 400, retired → 410, unknown → 400).
    const version = this._resolution.resolveWriteVersion('media', identifier, data.version);

    const result = await this._repository.upsert(
      orgId,
      identifier,
      {
        enabled: data.enabled,
        credentials: encryptedCredentials,
        storageProviderId: data.storageProviderId,
        storageRootFolderId: data.storageRootFolderId,
      },
      version,
    );

    if (data.storageProviderId && data.storageRootFolderId) {
      await this.ensureStandardFolders(orgId, data.storageRootFolderId);
    }

    // §11.4 auto-config: OpenAI/MiniMax media credentials live-link to the AI surface.
    if (data.credentials && this._credentialLink) {
      await this._credentialLink.syncFromMediaProvider(orgId, identifier, data.credentials);
    }

    // 1.3a: evict the cached capability so the next resolve rebuilds with fresh creds.
    this._resolution.invalidate('media', identifier, orgId);

    return result;
  }

  async delete(orgId: string, identifier: string) {
    const result = await this._repository.delete(orgId, identifier);
    // 1.3a: evict the cached capability for the deleted config.
    this._resolution.invalidate('media', identifier, orgId);
    return result;
  }

  /**
   * Mark a provider as the org's Primary media provider (call-time default;
   * plan §1.4/§2.4). Validates the provider is configured (own creds OR the
   * universal-credential AI fallback), ensures a row exists to flip, then clears
   * the prior Primary's `isActive` and sets this one (enable-many + one Primary).
   */
  async setActive(orgId: string, identifier: string, version?: string) {
    const resolvedVersion =
      version ?? this._resolution.latestActiveVersion('media', identifier) ?? 'v1';
    // Use a credential check that IGNORES the enabled flag — setActive is itself
    // turning the provider on, so a currently-disabled row with valid creds (own
    // or the universal AI-key fallback) must still be promotable.
    if (!(await this._hasAnyCredentials(orgId, identifier, resolvedVersion))) {
      throw new Error(
        `Media provider "${identifier}" is not configured. Add credentials first.`,
      );
    }
    // Universal-credential providers (Qwen) may have no media row yet — make one so
    // there is an `isActive` flag to flip.
    await this._repository.upsert(orgId, identifier, { enabled: true }, resolvedVersion);
    return this._repository.setActive(orgId, identifier, resolvedVersion);
  }

  /** The org's Primary media provider row, or null. Studio pickers default to it. */
  async getPrimaryProvider(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    return configs.find((c) => c.isActive) ?? null;
  }

  /** Identifiers enabled in at least one org — for the platform-admin overview. */
  async getEnabledIdentifiers(): Promise<string[]> {
    return this._repository.getEnabledIdentifiers();
  }

  // 1.7: the single enforcement point for "is this provider usable for this
  // operation right now". An explicit row's `enabled:false` is OFF; a
  // universal-credential provider with no explicit row inherits enabled when the
  // org has the matching AI key. Wired into MediaStudioService.generate/listModels.
  async isProviderEnabledForOperation(orgId: string, identifier: string, operation: string): Promise<boolean> {
    // §6.2: version-AGNOSTIC read — getByIdentifier defaults to v1, so once any provider
    // pins v2 a universal provider's explicit `enabled:false` (a v2 row) would be missed
    // and the AI-key fallback would wrongly read back as enabled.
    const config = await this._repository.findAnyByIdentifier(orgId, identifier);
    if (config) {
      if (!config.enabled) return false;
      if (!config.extraConfig) return true;
      const ops = this._parseExtraConfig(config.extraConfig).operations;
      if (!ops || ops.length === 0) return true;
      return ops.includes(operation);
    }
    // No explicit media row: universal-credential providers are enabled when the
    // org has the AI key (the inherited-enabled state shown by getProviders).
    if (UNIVERSAL_AI_CREDENTIAL.has(identifier)) {
      return !!(await this._aiCredentials(orgId, identifier));
    }
    return false;
  }

  async getConfigForProvider(
    orgId: string,
    identifier: string,
    version?: string,
    opts?: { includeDisabled?: boolean },
  ) {
    // 1.4: resolve the pinned version (stored row's version, else latest-active)
    // rather than hardcoding v1, so callers that pass no version still hit the
    // actually-pinned row once a v2 ships.
    const resolvedVersion = version ?? (await this._getPinnedVersion(orgId, identifier));
    const config = await this._repository.getByIdentifier(orgId, identifier, resolvedVersion);
    // 1.1: this is the credential-resolution path every generation surface funnels
    // through (HeyGen/Deepgram/chat-tool/governance-media/lifecycle/studio). An
    // explicit `enabled:false` row is OFF — return null so a provider the org
    // disabled to stop spend can't keep billing (its own key OR, for a universal
    // provider, the AI-key fallback). Non-generation display paths use getProviders;
    // testConnection reads the row directly, so a disabled provider is still testable.
    // `includeDisabled` is the documented exception for IN-FLIGHT work only
    // (media-job-lifecycle polling a render that was submitted while enabled):
    // completing already-paid work costs nothing new, so a mid-render disable
    // must not destroy it. Never pass it from a generation entry point.
    if (config && config.enabled === false && !opts?.includeDisabled) {
      return null;
    }
    const credentials = config ? this._decryptCredentials(config.credentials) : {};
    // Prefer the dedicated media credential; for universal-credential providers (Qwen),
    // fall back to the org's AI provider key so the same key drives both surfaces.
    if (
      Object.keys(credentials).length === 0 &&
      UNIVERSAL_AI_CREDENTIAL.has(identifier)
    ) {
      const aiCredentials = await this._aiCredentials(
        orgId,
        identifier,
        opts?.includeDisabled,
      );
      if (aiCredentials) {
        return {
          credentials: aiCredentials,
          storageProviderId: config?.storageProviderId ?? null,
          storageRootFolderId: config?.storageRootFolderId ?? null,
          version: config?.version ?? resolvedVersion,
        };
      }
    }
    if (!config) return null;
    return {
      credentials,
      storageProviderId: config.storageProviderId,
      storageRootFolderId: config.storageRootFolderId,
      version: config.version,
    };
  }

  // 1.4: the version an org's row is pinned to — the stored row's version, else
  // the latest active version, else v1. Mirrors OrgShortLinkSettingsService.getPinnedVersion.
  private async _getPinnedVersion(orgId: string, identifier: string): Promise<string> {
    // 1.2: version-AGNOSTIC read — findUnique-by-v1 misses a v2-pinned row.
    const config = await this._repository.findAnyByIdentifier(orgId, identifier);
    return (
      config?.version ??
      this._resolution.latestActiveVersion('media', identifier) ??
      'v1'
    );
  }

  // Credential presence check that ignores the enabled flag (own creds OR the
  // universal AI-key fallback). Used by setActive, which is turning the provider on.
  private async _hasAnyCredentials(orgId: string, identifier: string, version: string): Promise<boolean> {
    const config = await this._repository.getByIdentifier(orgId, identifier, version);
    const own = config ? this._decryptCredentials(config.credentials) : {};
    if (Object.keys(own).length > 0) return true;
    if (UNIVERSAL_AI_CREDENTIAL.has(identifier)) {
      return !!(await this._aiCredentials(orgId, identifier));
    }
    return false;
  }

  async testConnection(
    orgId: string,
    identifier: string,
    credentials?: Record<string, string>,
  ) {
    if (credentials) {
      const adapter = this._resolution.resolveMedia(identifier, {
        credentials,
        orgId,
      });
      return this.#runAdapterTest(adapter, credentials);
    }

    // §6.2: version-agnostic read so a v2-pinned row is testable (getByIdentifier's v1
    // default would report an otherwise-configured provider as "not configured").
    const config = await this._repository.findAnyByIdentifier(orgId, identifier);
    if (!config) {
      throw new Error(`Media provider "${identifier}" not configured for this organization`);
    }

    const testCredentials = this._decryptCredentials(config.credentials);
    const adapter = this._resolution.resolveMedia(identifier, {
      version: config.version,
      credentials: testCredentials,
      orgId,
    });

    return this.#runAdapterTest(adapter, testCredentials);
  }

  async #runAdapterTest(adapter: MediaProviderAdapter, credentials: Record<string, string>) {
    try {
      // Prefer the adapter's own auth check; only image-capable providers can be
      // verified via generateImage. Without either, the key can't be actively tested.
      if (adapter.testConnection) {
        return await adapter.testConnection({ credentials });
      }
      if (adapter.capabilities.image) {
        await adapter.generateImage('test', { credentials });
        return { ok: true, message: 'Connection successful' };
      }
      return { ok: true, message: 'Credentials saved (no live connection test for this provider)' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  // Decrypt the org's AI provider credentials for a universal-credential provider. Per-org
  // AI configs (AIOrgProviderConfig, written by OrgAiSettingsService) are encrypted with the
  // SAME EncryptionService as media creds — so reuse our own _decryptCredentials. (Note: the
  // GLOBAL AIProviderConfig uses AuthService.fixedEncryption instead; the two are NOT
  // interchangeable, which is why we read the org row directly rather than via AiSettingsService.)
  private async _aiCredentials(
    orgId: string,
    identifier: string,
    includeDisabled = false,
  ): Promise<Record<string, string> | null> {
    if (!this._orgAiRepository) return null;
    // 1.2: version-agnostic read — a Qwen/Google AI config pinned to v2 must
    // still drive the universal-credential fallback (findUnique-by-v1 missed it).
    const config = await this._orgAiRepository.findAnyByIdentifier(orgId, identifier);
    if (!config?.credentials) return null;
    // 1.1(b): fold the AI row's `enabled` into the universal-credential fallback —
    // disabling the org's Qwen/Google AI key must also stop the media studio from
    // billing that same key. A disabled AI row yields no fallback credentials
    // (except for in-flight-job polling, see getConfigForProvider includeDisabled).
    if (config.enabled === false && !includeDisabled) return null;
    const credentials = this._decryptCredentials(config.credentials);
    return Object.keys(credentials).length > 0 ? credentials : null;
  }

  // 1.1 (review): whether the org holds an explicit media row for this provider
  // that is switched OFF. The governance-media fallback (AiMediaService →
  // _credentialsForMediaProvider) must not route around a deliberate media-side
  // disable by reading the raw AI config row.
  async isProviderExplicitlyDisabled(orgId: string, identifier: string): Promise<boolean> {
    const config = await this._repository.findAnyByIdentifier(orgId, identifier);
    return config?.enabled === false;
  }

  // Which universal-credential adapters (Qwen) the org has an AI key for — drives the
  // configured/active flags in getProviders without a media credential row.
  private async _universalAiConfigured(
    orgId: string,
    adapters: { identifier: string }[],
  ): Promise<Set<string>> {
    const universal = adapters.filter((a) => UNIVERSAL_AI_CREDENTIAL.has(a.identifier));
    const configured = new Set<string>();
    await Promise.all(
      universal.map(async (a) => {
        if (await this._aiCredentials(orgId, a.identifier)) configured.add(a.identifier);
      }),
    );
    return configured;
  }

  private _parseExtraConfig(extraConfig: string | null | undefined): MediaProviderExtraConfig {
    if (!extraConfig) return {};
    try {
      const parsed = JSON.parse(extraConfig) as MediaProviderExtraConfig;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private _decryptCredentials(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(this._encryption.decrypt(encrypted));
    } catch {
      this._logger.warn('Failed to decrypt media provider credentials');
      return {};
    }
  }

  // Ensure the provider root's typed 5-folder tree (§11.5). Public so the async-job
  // completion path can lazily (re)create it before landing an artifact.
  async ensureStandardFolders(orgId: string, rootFolderId: string) {
    const existing = await this._fileService.findFoldersByParent(orgId, rootFolderId);
    const existingNames = new Set(existing.map((f) => f.name.toLowerCase()));

    for (const folderName of STANDARD_FOLDERS) {
      if (!existingNames.has(folderName)) {
        try {
          await this._fileService.createFolder(orgId, {
            name: folderName,
            parentId: rootFolderId,
          });
        } catch (err) {
          this._logger.warn(`Failed to create standard folder "${folderName}": ${(err as Error).message}`);
        }
      }
    }
  }

  // Resolve (creating on demand) the typed folder under a provider root.
  async getStandardFolderId(orgId: string, rootFolderId: string, folderName: string): Promise<string | null> {
    if (!STANDARD_FOLDERS.includes(folderName)) return null;
    await this.ensureStandardFolders(orgId, rootFolderId);
    const folders = await this._fileService.findFoldersByParent(orgId, rootFolderId);
    const match = folders.find((f) => f.name.toLowerCase() === folderName);
    return match?.id ?? null;
  }
}
