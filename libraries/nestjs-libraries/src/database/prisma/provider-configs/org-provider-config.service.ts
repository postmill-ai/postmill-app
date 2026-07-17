import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrgProviderConfigRepository } from './org-provider-config.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { OrgVpnConfigService } from '@gitroom/nestjs-libraries/vpn/org-vpn-config.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

// Optional VPN egress selection stored (as JSON) on the channel config. Not a
// secret — just which enabled org VPN provider×region the channel routes through.
export type ChannelVpnSelection = {
  enabled: boolean;
  identifier?: string;
  regionId?: string;
  vpnVersion?: string;
};

export type DecryptedOrgProviderConfig = {
  id: string;
  organizationId: string;
  identifier: string;
  name: string;
  version: string;
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  additionalConfig?: string;
  redirectUri?: string;
  scopes?: string;
  setupNotes?: string;
  vpnSelection?: ChannelVpnSelection | null;
  createdAt: Date;
  updatedAt: Date;
};

type WritableConfig = {
  name?: string;
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  scopes?: string | null;
  additionalConfig?: string | null;
  setupNotes?: string | null;
  vpnSelection?: ChannelVpnSelection | null;
  version?: string;
};

@Injectable()
export class OrgProviderConfigService {
  private readonly _logger = new Logger(OrgProviderConfigService.name);

  constructor(
    private _repository: OrgProviderConfigRepository,
    private _encryption: EncryptionService,
    private _vpn: OrgVpnConfigService,
    private _resolution: ProviderResolutionService,
    private _audit: AuditService
  ) {}

  // No secrets — orgId/userId/action/provider identity only (#59).
  #audit(action: string, orgId: string, identifier: string, userId?: string) {
    this._logger.log(
      `channel-config.${action} org=${orgId} user=${userId || 'n/a'} provider=${identifier}`
    );
  }

  // F2(c): credential create/rotate audit event. Non-fatal; metadata carries ONLY the
  // provider identifier + config id — never the client id/secret.
  #recordCredentialRotated(
    orgId: string,
    identifier: string,
    configId: string,
    userId?: string
  ) {
    try {
      Promise.resolve(
        this._audit.record({
          orgId,
          userId,
          action: 'credential.rotated',
          resource: 'channel-credential',
          resourceId: configId,
          metadata: { provider: identifier, configId },
        })
      ).catch(() => {});
    } catch {
      /* non-fatal: auditing must never break the credential write */
    }
  }

  // 1.1: pin a new or existing config to a lifecycle-validated version. The
  // client-supplied (or already-pinned) version is validated through
  // resolveWriteVersion — a deprecated version rejects the write, retired is 410,
  // unknown is 400 — replacing the unvalidated `latestActive ?? 'v1'`.
  #resolveVersion(identifier: string, explicitVersion?: string | null, existingVersion?: string | null): string {
    // 1.4: on an update, `existingVersion` is the row's current pin — pass it as
    // `currentVersion` so an in-place edit (disable / credential rotation) of a
    // deprecated-pinned row is allowed; only a create or an explicit change to a
    // deprecated/retired version is rejected.
    return this._resolution.resolveWriteVersion(
      'social',
      identifier,
      explicitVersion || existingVersion || undefined,
      existingVersion ? { currentVersion: existingVersion } : undefined,
    );
  }

  async getConfigs(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    return configs.map((c) => this.#maskSensitive(c));
  }

  async getConfigById(orgId: string, id: string) {
    const config = await this._repository.getById(orgId, id);
    return config ? this.#maskSensitive(config) : undefined;
  }

  // Return every org config with decrypted secrets. This is the canonical way for
  // the manager to refresh its per-org credential cache without reaching into the
  // repository directly.
  async getDecryptedConfigs(
    orgId: string
  ): Promise<DecryptedOrgProviderConfig[]> {
    const configs = await this._repository.getByOrg(orgId);
    return configs.map((config) => {
      const decrypted = this.#decryptConfig(config);
      return {
        ...config,
        clientId: decrypted.clientId,
        clientSecret: decrypted.clientSecret,
        additionalConfig: decrypted.additionalConfig,
        version: config.version ?? 'v1',
        redirectUri: config.redirectUri || undefined,
        scopes: config.scopes || undefined,
        setupNotes: config.setupNotes || undefined,
        vpnSelection: this.#parseVpn(config.vpnSelection),
      };
    });
  }

  // Decrypt credentials for a specific named config (used when an account/connection
  // is bound to that config — each named set has its own auth).
  async getCredentialsByConfigId(orgId: string, configId: string) {
    const config = await this._repository.getById(orgId, configId);
    if (!config) return undefined;
    return this.#decryptConfig(config);
  }

  // Fallback: decrypt by provider type (enabled-or-first) for unbound integrations.
  async getCredentials(orgId: string, identifier: string) {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    if (!config) return undefined;

    return this.#decryptConfig(config);
  }

  async getEnabledIdentifiers(orgId: string): Promise<string[]> {
    const configs = await this._repository.getEnabledByOrg(orgId);
    return [...new Set(configs.map((c) => c.identifier))];
  }

  async isEnabled(orgId: string, identifier: string): Promise<boolean> {
    const config = await this._repository.getByIdentifier(orgId, identifier);
    return config?.enabled === true;
  }

  async createConfig(
    orgId: string,
    data: WritableConfig & { identifier: string; name: string },
    userId?: string
  ) {
    const name = (data.name || '').trim();
    if (!name) {
      throw new BadRequestException('A channel name is required.');
    }

    if (data.enabled && !data.clientId?.trim()) {
      throw new BadRequestException(
        'A provider must be configured with credentials before it can be enabled.'
      );
    }

    const result = await this._repository.create(orgId, {
      identifier: data.identifier,
      name,
      version: this.#resolveVersion(data.identifier, data.version),
      enabled: data.enabled ?? false,
      ...this.#encryptWritable(data),
      redirectUri: data.redirectUri ?? null,
      scopes: data.scopes ?? null,
      setupNotes: data.setupNotes ?? null,
      vpnSelection: (await this.#serializeVpn(orgId, data.vpnSelection)) ?? null,
    });

    this.#audit('create', orgId, data.identifier, userId);
    this.#recordCredentialRotated(orgId, data.identifier, result.id, userId);
    // 1.3a: evict the cached kernel capability so a resolve rebuilds with fresh creds.
    this._resolution.invalidate('social', data.identifier, orgId);
    return this.#maskSensitive(result);
  }

  async updateConfig(
    orgId: string,
    id: string,
    data: WritableConfig,
    userId?: string
  ) {
    const existing = await this._repository.getById(orgId, id);
    if (!existing) {
      throw new NotFoundException('Channel config not found.');
    }

    if (data.name !== undefined && !data.name.trim()) {
      throw new BadRequestException('A channel name is required.');
    }

    const willBeEnabled = data.enabled ?? existing.enabled;
    if (willBeEnabled) {
      const hasNewClientId = !!data.clientId?.trim();
      if (!hasNewClientId && !existing.clientId?.trim()) {
        throw new BadRequestException(
          'A provider must be configured with credentials before it can be enabled.'
        );
      }
    }

    const update: WritableConfig = { ...this.#encryptWritable(data) };
    if (data.name !== undefined) update.name = data.name.trim();
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.redirectUri !== undefined) update.redirectUri = data.redirectUri;
    if (data.scopes !== undefined) update.scopes = data.scopes;
    if (data.setupNotes !== undefined) update.setupNotes = data.setupNotes;
    update.version = this.#resolveVersion(existing.identifier, data.version, existing.version);
    if (data.vpnSelection !== undefined) {
      (update as any).vpnSelection = await this.#serializeVpn(orgId, data.vpnSelection);
    }

    const result = await this._repository.updateById(orgId, id, update as any);
    this.#audit('update', orgId, existing.identifier, userId);
    this.#recordCredentialRotated(orgId, existing.identifier, id, userId);
    // 1.3a: evict the cached kernel capability so a resolve rebuilds with fresh creds.
    this._resolution.invalidate('social', existing.identifier, orgId);
    return this.#maskSensitive(result);
  }

  async deleteConfig(orgId: string, id: string, userId?: string) {
    const existing = await this._repository.getById(orgId, id);
    if (!existing) {
      throw new NotFoundException('Channel config not found.');
    }
    await this._repository.deleteById(orgId, id);
    this.#audit('delete', orgId, existing.identifier, userId);
    // 1.3a: evict the cached kernel capability for this provider.
    this._resolution.invalidate('social', existing.identifier, orgId);
  }

  async testConnection(
    orgId: string,
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const config = await this._repository.getById(orgId, id);
    if (!config) {
      return { success: false, error: 'Provider not configured' };
    }

    const decrypted = this.#decryptConfig(config);
    if (!decrypted.clientId) {
      return { success: false, error: 'Client ID not configured' };
    }

    // 6.7: never echo the decrypted OAuth clientId back to the client. The old
    // return embedded `client_id=${decrypted.clientId}` in an authUrl, leaking
    // the exact secret `#maskSensitive` deliberately withholds. Report only that
    // credentials are present and decryptable.
    return { success: true };
  }

  // Resolve the active VPN selection for a connecting integration (by its bound
  // config, else by provider type). Returns null when no VPN is enabled.
  async getVpnSelectionForIntegration(
    orgId: string,
    configId: string | null | undefined,
    identifier: string
  ): Promise<{ identifier: string; regionId: string; vpnVersion?: string } | null> {
    const config = configId
      ? await this._repository.getById(orgId, configId)
      : await this._repository.getByIdentifier(orgId, identifier);
    const parsed = this.#parseVpn(config?.vpnSelection);
    if (parsed?.enabled && parsed.identifier && parsed.regionId) {
      return { identifier: parsed.identifier, regionId: parsed.regionId, vpnVersion: parsed.vpnVersion };
    }
    return null;
  }

  // Validate a selection against the org's actually-enabled VPN regions and
  // serialize to the stored JSON. undefined ⇒ leave column unchanged.
  async #serializeVpn(
    orgId: string,
    sel: ChannelVpnSelection | null | undefined
  ): Promise<string | null | undefined> {
    if (sel === undefined) return undefined;
    if (sel === null || !sel.enabled) return null;

    const identifier = sel.identifier?.trim();
    const regionId = sel.regionId?.trim();
    if (!identifier || !regionId) {
      throw new BadRequestException('Select a VPN provider and region to enable VPN.');
    }
    const enabled = await this._vpn.listEnabledRegions(orgId);
    if (!enabled.some((r) => r.identifier === identifier && r.regionId === regionId)) {
      throw new BadRequestException('The selected VPN region is not enabled for this organization.');
    }
    return JSON.stringify({ enabled: true, identifier, regionId, vpnVersion: sel.vpnVersion });
  }

  #parseVpn(raw: string | null | undefined): ChannelVpnSelection | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as ChannelVpnSelection) : null;
    } catch {
      return null;
    }
  }

  #encryptWritable(data: WritableConfig): WritableConfig {
    const encrypted: WritableConfig = {};
    if (data.clientId !== undefined) {
      encrypted.clientId = this.#maybeEncrypt(data.clientId);
    }
    if (data.clientSecret !== undefined) {
      encrypted.clientSecret = this.#maybeEncrypt(data.clientSecret);
    }
    if (data.additionalConfig !== undefined) {
      encrypted.additionalConfig = this.#maybeEncrypt(data.additionalConfig);
    }
    return encrypted;
  }

  #maybeEncrypt(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') return value;
    return this._encryption.encrypt(value);
  }

  #decryptConfig(config: {
    clientId?: string | null;
    clientSecret?: string | null;
    additionalConfig?: string | null;
  }): {
    clientId?: string;
    clientSecret?: string;
    additionalConfig?: string;
  } {
    return {
      clientId: config.clientId ? this._encryption.decrypt(config.clientId) : undefined,
      clientSecret: config.clientSecret ? this._encryption.decrypt(config.clientSecret) : undefined,
      additionalConfig: config.additionalConfig ? this._encryption.decrypt(config.additionalConfig) : undefined,
    };
  }

  #maskSensitive(config: {
    id: string;
    organizationId: string;
    identifier: string;
    name: string;
    version: string;
    enabled: boolean;
    clientId: string | null;
    clientSecret: string | null;
    additionalConfig: string | null;
    redirectUri: string | null;
    scopes: string | null;
    setupNotes: string | null;
    vpnSelection?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const hasClientId = config.clientId ? true : false;
    const hasClientSecret = config.clientSecret ? true : false;

    return {
      id: config.id,
      organizationId: config.organizationId,
      identifier: config.identifier,
      name: config.name,
      version: config.version ?? 'v1',
      enabled: config.enabled,
      isConfigured: hasClientId || hasClientSecret,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      setupNotes: config.setupNotes,
      vpnSelection: this.#parseVpn(config.vpnSelection),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}
