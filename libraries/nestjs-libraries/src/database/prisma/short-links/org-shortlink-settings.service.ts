import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ProviderKernel } from '@gitroom/provider-kernel';
import { OrgShortLinkSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { ShortLinkAdapter } from '@gitroom/nestjs-libraries/short-linking/short-link.interface';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { accountFingerprint } from '@gitroom/nestjs-libraries/utils/account-fingerprint';

@Injectable()
export class OrgShortLinkSettingsService {
  private readonly _logger = new Logger(OrgShortLinkSettingsService.name);

  constructor(
    private _repository: OrgShortLinkSettingsRepository,
    private _encryption: EncryptionService,
    private _resolution: ProviderResolutionService,
    @Inject(PROVIDER_KERNEL) private _kernel: ProviderKernel,
  ) {}

  // Resolve a single short-link adapter through the kernel, or null when the
  // provider is unknown/retired.
  private _adapterFor(identifier: string, version?: string): ShortLinkAdapter | null {
    try {
      return this._resolution.resolveShortLink(identifier, {
        version: version ?? 'v1',
      });
    } catch {
      return null;
    }
  }

  // The full catalog of registered short-link providers (one adapter per id),
  // sourced from the kernel manifests now that the in-memory registry is gone.
  private _listAdapters(): ShortLinkAdapter[] {
    const byId = new Map<string, ShortLinkAdapter>();
    for (const manifest of this._kernel.listManifests('shortlink')) {
      if (byId.has(manifest.providerId)) continue;
      const adapter = this._adapterFor(manifest.providerId, manifest.version);
      if (adapter) byId.set(manifest.providerId, adapter);
    }
    return [...byId.values()];
  }

  // Static provider metadata (no org context) for the settings list route.
  listProviderMetadata() {
    return this._listAdapters().map((adapter) => ({
      identifier: adapter.identifier,
      name: adapter.name,
      capabilities: adapter.capabilities,
      credentialFields: adapter.credentialFields,
      authType: adapter.authType,
      defaultDomain: adapter.defaultDomain,
      setupNotes: adapter.setupNotes,
    }));
  }

  /**
   * Resolve a short-link adapter through the kernel, throwing when the provider
   * is unknown/retired.
   */
  requireAdapter(identifier: string, version?: string): ShortLinkAdapter {
    const adapter = this._adapterFor(identifier, version);
    if (!adapter) {
      throw new BadRequestException('Unknown short-link provider');
    }
    return adapter;
  }

  // Deterministic, credential-derived fingerprint (server-side only). Undefined when
  // no credentials are supplied so passthrough/empty configs aren't wrongly deduped.
  computeAccountFingerprint(
    identifier: string,
    credentials?: Record<string, string>,
    customDomain?: string,
  ): string | undefined {
    if (!credentials || Object.keys(credentials).length === 0) {
      return undefined;
    }
    const canonical = Object.keys(credentials)
      .sort()
      .map((k) => `${k}=${credentials[k]}`)
      .join('&');
    return accountFingerprint(identifier, customDomain ?? '', canonical);
  }

  /**
   * Upsert a short-link config, routing an existing row to an in-place update
   * and a new row to a fingerprint-based create.
   */
  async upsertConfig(
    orgId: string,
    identifier: string,
    data: {
      credentials?: Record<string, string>;
      customDomain?: string;
      extraConfig?: Record<string, string>;
      name?: string;
      version?: string;
    },
  ) {
    this.requireAdapter(identifier);

    // PROVIDER_REMEDIATION 6.6: compute the fingerprint SERVER-SIDE with the shared
    // util (as Storage does) and ignore any client-supplied `body.accountFingerprint`
    // — a client-controlled value lets an attacker mint unlimited duplicate rows /
    // defeat dedupe.
    const accountFingerprint = this.computeAccountFingerprint(
      identifier,
      data.credentials,
      data.customDomain,
    );

    // PROVIDER_REMEDIATION_02 §0.3: when a config already exists for this
    // provider (the normal edit/rotate flow — the UI is single-config-per-
    // provider), update THAT row in place. Routing a rotation through the
    // fingerprint-`upsert` branch created a second inactive row with the new key
    // while `getActive()` kept returning the old row with the *revoked* key. The
    // explicit fingerprint-`create` path is reserved for a first save / an
    // explicit "add another account" flow (no existing row).
    const existingId = await this.getExistingConfigId(orgId, identifier);
    if (existingId) {
      await this.updateById(
        orgId,
        existingId,
        {
          credentials: data.credentials,
          customDomain: data.customDomain,
          extraConfig: data.extraConfig,
          name: data.name,
          accountFingerprint,
          version: data.version,
        },
        identifier,
      );
      return { identifier, success: true };
    }

    await this.upsert(orgId, identifier, {
      enabled: true,
      credentials: data.credentials,
      customDomain: data.customDomain,
      extraConfig: data.extraConfig,
      name: data.name,
      accountFingerprint,
      version: data.version,
    });

    return { identifier, success: true };
  }

  /**
   * Row-id-targeted in-place update (rotation / rename / re-key of a specific
   * account), computing the fingerprint server-side.
   */
  async updateConfigById(
    orgId: string,
    configId: string,
    identifier: string,
    data: {
      credentials?: Record<string, string>;
      customDomain?: string;
      extraConfig?: Record<string, string>;
      name?: string;
      version?: string;
    },
  ) {
    this.requireAdapter(identifier);

    await this.updateById(
      orgId,
      configId,
      {
        credentials: data.credentials,
        customDomain: data.customDomain,
        extraConfig: data.extraConfig,
        name: data.name,
        accountFingerprint: this.computeAccountFingerprint(
          identifier,
          data.credentials,
          data.customDomain,
        ),
        version: data.version,
      },
      identifier,
    );

    return { identifier, configId, success: true };
  }

  async getProviders(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    const adapters = this._listAdapters();
    return adapters.map((adapter) => {
      const dbConfigs = configs.filter((c) => c.identifier === adapter.identifier);
      const dbConfig = dbConfigs[dbConfigs.length - 1];
      const isConfigured = this._isConfigured(adapter, dbConfig);
      return {
        identifier: adapter.identifier,
        name: adapter.name,
        capabilities: adapter.capabilities,
        credentialFields: adapter.credentialFields,
        authType: adapter.authType,
        defaultDomain: adapter.defaultDomain,
        setupNotes: adapter.setupNotes,
        enabled: dbConfig?.enabled || false,
        isActive: dbConfig?.isActive || false,
        isConfigured,
        customDomain: dbConfig?.customDomain || '',
        configName: dbConfig?.name || '',
        accountFingerprint: dbConfig?.accountFingerprint || '',
        version: dbConfig?.version ?? 'v1',
        createdAt: dbConfig?.createdAt || null,
        updatedAt: dbConfig?.updatedAt || null,
        configs: dbConfigs.map((c) => ({
          id: c.id,
          name: c.name || '',
          accountFingerprint: c.accountFingerprint || '',
          isActive: c.isActive,
          customDomain: c.customDomain || '',
          version: c.version ?? 'v1',
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
      };
    });
  }

  async getActiveProvider(orgId: string) {
    const config = await this._repository.getActive(orgId);
    if (!config) return null;

    const adapter = this._adapterFor(config.identifier, config.version ?? 'v1');
    if (!adapter) return null;

    const decrypted = this._decryptCredentials(config.credentials);
    return {
      identifier: config.identifier,
      name: adapter.name,
      capabilities: adapter.capabilities,
      customDomain: config.customDomain,
      credentials: decrypted,
      version: config.version ?? 'v1',
    };
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      enabled?: boolean;
      isActive?: boolean;
      credentials?: Record<string, string>;
      customDomain?: string;
      extraConfig?: Record<string, string>;
      name?: string;
      accountFingerprint?: string;
      version?: string;
    },
  ) {
    const encryptedCredentials = data.credentials
      ? this._encryption.encrypt(JSON.stringify(data.credentials))
      : undefined;

    const encryptedExtraConfig = data.extraConfig
      ? this._encryption.encrypt(JSON.stringify(data.extraConfig))
      : undefined;

    // 1.1: validate the client-supplied (or defaulted) version against the
    // lifecycle before pinning — a deprecated version rejects the write, retired
    // is 410, unknown is 400. Replaces the unvalidated `latestActive ?? 'v1'`.
    const version = this._resolution.resolveWriteVersion('shortlink', identifier, data.version);

    const result = await this._repository.upsert(orgId, identifier, {
      ...data,
      credentials: encryptedCredentials,
      extraConfig: encryptedExtraConfig,
      customDomain: data.customDomain,
      name: data.name,
      accountFingerprint: data.accountFingerprint,
      version,
    });
    // 1.3a: drop any cached capability so the next resolve rebuilds with fresh creds.
    this._resolution.invalidate('shortlink', identifier, orgId);
    return result;
  }

  // The id of the existing config row for this org+identifier, or null. Prefers
  // the ACTIVE row (the one getActive()/short-link calls actually read) over the
  // newest — orgs already carrying pre-fix duplicate rows have an active row on
  // the revoked key plus a newer inactive one, and rotation must heal the active
  // row, not the newest (PROVIDER_REMEDIATION_02 §0.3 + review F7). Used to route
  // a credentialed save to an in-place update instead of a fingerprint-create.
  async getExistingConfigId(
    orgId: string,
    identifier: string,
  ): Promise<string | null> {
    const active = await this._repository.getActiveByIdentifier(orgId, identifier);
    if (active) return active.id;
    const config = await this._repository.getByIdentifier(orgId, identifier);
    return config?.id ?? null;
  }

  // Row-id-targeted in-place update — the rotation-safe path. Preserves the row's
  // pinned version (an in-place edit is allowed even on a deprecated-pinned row);
  // only an explicit version *change* re-pins through the lifecycle validator.
  // `identifier` (when supplied) must match the row's provider — the row-id route
  // carries both, and a mismatch would stamp a fingerprint computed for the wrong
  // provider onto the row (review F9).
  async updateById(
    orgId: string,
    configId: string,
    data: {
      credentials?: Record<string, string>;
      customDomain?: string;
      extraConfig?: Record<string, string>;
      name?: string;
      accountFingerprint?: string;
      version?: string;
    },
    identifier?: string,
  ) {
    const existing = await this._repository.getById(orgId, configId);
    if (!existing) {
      throw new Error('Configuration not found');
    }
    if (identifier && existing.identifier !== identifier) {
      throw new BadRequestException(
        'Configuration does not belong to this provider',
      );
    }

    const encryptedCredentials = data.credentials
      ? this._encryption.encrypt(JSON.stringify(data.credentials))
      : undefined;
    const encryptedExtraConfig = data.extraConfig
      ? this._encryption.encrypt(JSON.stringify(data.extraConfig))
      : undefined;

    let version = existing.version ?? undefined;
    if (data.version && data.version !== existing.version) {
      version = this._resolution.resolveWriteVersion(
        'shortlink',
        existing.identifier,
        data.version,
      );
    }

    let result;
    try {
      result = await this._repository.updateById(orgId, configId, {
        enabled: true,
        ...(encryptedCredentials !== undefined
          ? { credentials: encryptedCredentials }
          : {}),
        ...(encryptedExtraConfig !== undefined
          ? { extraConfig: encryptedExtraConfig }
          : {}),
        ...(data.customDomain !== undefined
          ? { customDomain: data.customDomain }
          : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.accountFingerprint !== undefined
          ? { accountFingerprint: data.accountFingerprint }
          : {}),
        ...(version !== undefined ? { version } : {}),
      });
    } catch (err) {
      // Duplicate-row orgs (pre-fix state): writing this row's fingerprint can
      // collide with a stale sibling row's on the compound unique — map the
      // P2002 to a clean 400 instead of a raw 500 (review F8).
      if ((err as { code?: string })?.code === 'P2002') {
        throw new BadRequestException(
          'Another configuration for this provider already uses these credentials. Remove the duplicate configuration first.',
        );
      }
      throw err;
    }
    // 1.3a: drop any cached capability so the next resolve rebuilds with fresh creds.
    this._resolution.invalidate('shortlink', existing.identifier, orgId);
    return result;
  }

  async setActive(orgId: string, identifier: string, version?: string) {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    if (!config) {
      throw new Error(`Short-link provider "${identifier}" not configured for this organization`);
    }

    const adapter = this._adapterFor(identifier, config.version ?? 'v1');
    if (!adapter) {
      throw new Error(`Unknown short-link provider: ${identifier}`);
    }

    const decrypted = this._decryptCredentials(config.credentials);
    if (!this._hasRequiredCredentials(adapter, decrypted)) {
      throw new Error(`Short-link provider "${identifier}" is not fully configured. Fill in all required credential fields first.`);
    }

    const pinnedVersion =
      version ?? this._resolution.latestActiveVersion('shortlink', identifier) ?? 'v1';

    return this._repository.setActive(orgId, identifier, pinnedVersion);
  }

  async delete(orgId: string, identifier: string) {
    const result = await this._repository.delete(orgId, identifier);
    // 1.3a: evict the cached capability so a re-add rebuilds it fresh.
    this._resolution.invalidate('shortlink', identifier, orgId);
    return result;
  }

  async deleteById(orgId: string, id: string) {
    const config = await this._repository.getById(orgId, id);
    if (!config) throw new Error('Configuration not found');
    const result = await this._repository.deleteById(orgId, id);
    // 1.3a: evict the cached capability for this provider.
    this._resolution.invalidate('shortlink', config.identifier, orgId);
    return result;
  }

  getLinksForOrg(orgId: string) {
    return this._repository.getLinksForOrg(orgId);
  }

  upsertSnapshotsBatch(
    rows: {
      shortLinkId: string;
      organizationId: string;
      date: Date;
      clicks: number;
    }[],
  ) {
    return this._repository.upsertSnapshotsBatch(rows);
  }

  pruneSnapshots(orgId: string, before: Date) {
    return this._repository.pruneSnapshots(orgId, before);
  }

  getAggregatedClicks(orgId: string, from: Date, to: Date) {
    return this._repository.getAggregatedClicks(orgId, from, to);
  }

  // Resolve the version pinned for this org+identifier (the same way upsert /
  // set-active do): the stored config's version, else the latest active version,
  // else v1. Used by the OAuth subroutes so authorize/callback resolve the same
  // pinned version as the config.
  async getPinnedVersion(orgId: string, identifier: string): Promise<string> {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    return (
      config?.version ??
      this._resolution.latestActiveVersion('shortlink', identifier) ??
      'v1'
    );
  }

  async getConfigForProvider(orgId: string, identifier: string) {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    if (!config) return null;
    const credentials = this._decryptCredentials(config.credentials);
    const extraConfig = this._parseExtraConfig(config.extraConfig);
    return { credentials, extraConfig };
  }

  async testConnection(
    orgId: string,
    identifier: string,
    credentials?: Record<string, string>,
    customDomain?: string,
  ) {
    if (credentials) {
      const adapter = this.requireAdapter(identifier);
      return adapter.validateCredentials({
        orgId,
        credentials,
        customDomain,
      });
    }

    const config = await this._repository.getByIdentifier(orgId, identifier);
    if (!config) {
      throw new Error(`Short-link provider "${identifier}" not configured for this organization`);
    }

    const adapter = this.requireAdapter(identifier);
    const decrypted = this._decryptCredentials(config.credentials);
    return adapter.validateCredentials({
      orgId,
      credentials: decrypted,
      customDomain: config.customDomain || undefined,
      extraConfig: this._parseExtraConfig(config.extraConfig),
    });
  }

  private _decryptCredentials(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(this._encryption.decrypt(encrypted));
    } catch {
      this._logger.warn('Failed to decrypt short-link provider credentials');
      return {};
    }
  }

  private _parseExtraConfig(extraConfig: string | null): Record<string, string> {
    if (!extraConfig) return {};
    try {
      const decrypted = this._encryption.decrypt(extraConfig);
      const parsed = JSON.parse(decrypted);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      // Fallback for legacy plaintext extraConfig
    }
    try {
      const parsed = JSON.parse(extraConfig);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private _isConfigured(
    adapter: { credentialFields: { key: string; required: boolean }[] },
    config: { credentials?: string | null; enabled?: boolean } | undefined,
  ): boolean {
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
