import { Injectable, Logger } from '@nestjs/common';
import { OrgContentPackSettingsRepository } from './org-content-pack-settings.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import {
  parseQualified,
  qualify,
  DEFAULT_VERSION,
} from '@gitroom/provider-kernel';
import {
  ContentPackMeta,
  manifestToContentPackMeta,
} from '@gitroom/nestjs-libraries/media/stock/content-packs/content-pack.registry';

@Injectable()
export class OrgContentPackSettingsService {
  private readonly _logger = new Logger(OrgContentPackSettingsService.name);

  constructor(
    private _repository: OrgContentPackSettingsRepository,
    private _encryption: EncryptionService,
    private _resolution: ProviderResolutionService,
  ) {}

  async getProviders(orgId: string) {
    const configs = await this._repository.getByOrg(orgId);
    const pointer = await this._repository.getActivePointer(orgId);
    const active = this.#parseActivePointer(pointer?.activeContentPackIdentifier);

    return this.#listMeta().map((meta) => {
      const config = configs.find((c) => c.identifier === meta.identifier);
      return {
        identifier: meta.identifier,
        name: meta.name,
        capabilities: meta.capabilities,
        isConfigured: !!config?.credentials,
        isActive: active?.identifier === meta.identifier,
        version: config?.version ?? 'v1',
        createdAt: config?.createdAt || null,
        updatedAt: config?.updatedAt || null,
      };
    });
  }

  async getActive(orgId: string) {
    const pointer = await this._repository.getActivePointer(orgId);
    const active = this.#parseActivePointer(pointer?.activeContentPackIdentifier);
    if (!active) return null;

    const config = await this._repository.getByIdentifier(
      orgId,
      active.identifier,
      active.version
    );
    if (!config || !config.credentials) return null;

    const credentials = this._decryptCredentials(config.credentials);
    // 6.3: a decrypt failure yields empty creds. Treat that as "no active pack"
    // (return null → fall back to the free provider) rather than resolving a
    // pack with blank credentials that would fail every call.
    if (!credentials || Object.keys(credentials).length === 0) return null;

    return {
      identifier: active.identifier,
      version: active.version,
      credentials,
      extraConfig: (config.extraConfig as Record<string, any>) || {},
    };
  }

  /**
   * Safe, client-ready metadata for the active content pack (no credentials).
   * Returns null when there is no active pack.
   */
  async getActiveProviderMetadata(orgId: string) {
    const active = await this.getActive(orgId);
    if (!active) return null;

    const meta = this.#meta(active.identifier);
    return {
      identifier: active.identifier,
      name: meta?.name || active.identifier,
      capabilities: meta?.capabilities || [],
    };
  }

  /**
   * Static catalog metadata for every registered content-pack provider.
   * Used by the settings UI to render the provider list.
   */
  listProviderMetadata() {
    return this.#listMeta().map((meta) => ({
      identifier: meta.identifier,
      name: meta.name,
      capabilities: meta.capabilities,
      credentialFields: meta.credentialFields,
    }));
  }

  /**
   * Metadata for a single registered content-pack provider, or undefined
   * when the identifier is unknown.
   */
  getProviderMetadata(identifier: string): ContentPackMeta | undefined {
    return this.#meta(identifier);
  }

  async getActiveForCapability(orgId: string, capability: string) {
    const active = await this.getActive(orgId);
    if (!active) return null;

    // 1.6: if the active pack pins a retired version or its module failed boot
    // registration, resolution throws (ProviderNotFoundError /
    // ProviderVersionRetiredError). Degrade to the free provider (return null)
    // instead of 500-ing every stock search for the org.
    let capabilityInstance;
    try {
      capabilityInstance = this._resolution.resolveContentPack(active.identifier, {
        version: active.version,
        credentials: active.credentials,
        orgId,
        extras: { extraConfig: active.extraConfig },
      });
    } catch (err) {
      this._logger.warn(
        `Content pack "${active.identifier}@${active.version}" could not be resolved; falling back to the free provider: ${(err as Error).message}`,
      );
      return null;
    }
    if (!capabilityInstance.capabilities.includes(capability as any)) return null;
    return { capability: capabilityInstance, active };
  }

  async upsert(
    orgId: string,
    identifier: string,
    data: {
      credentials?: Record<string, string>;
      extraConfig?: Record<string, any>;
      version?: string;
    }
  ) {
    const encryptedCredentials = data.credentials
      ? this._encryption.encrypt(JSON.stringify(data.credentials))
      : undefined;

    // 1.1: validate the (client-supplied or defaulted) version against the
    // lifecycle before pinning (deprecated → 400, retired → 410, unknown → 400).
    const version = this._resolution.resolveWriteVersion('contentpack', identifier, data.version);

    const result = await this._repository.upsert(orgId, identifier, {
      credentials: encryptedCredentials,
      extraConfig: data.extraConfig,
    }, version);

    // 1.3a: evict the cached capability so the next resolve rebuilds with fresh creds.
    this._resolution.invalidate('contentpack', identifier, orgId);

    return result;
  }

  async setActive(orgId: string, identifier: string | null) {
    if (!identifier) {
      return this._repository.setActivePointer(orgId, null);
    }

    const { providerId, version: explicitVersion } = parseQualified(identifier);
    const version =
      explicitVersion ??
      this._resolution.latestActiveVersion('contentpack', providerId) ??
      DEFAULT_VERSION;

    const config = await this._repository.getByIdentifier(orgId, providerId, version);
    if (!config) {
      throw new Error(`Content pack "${providerId}@${version}" is not configured for this organization`);
    }
    const credentials = this._decryptCredentials(config.credentials);
    if (!credentials?.apiKey) {
      throw new Error(`Content pack "${providerId}@${version}" is missing credentials`);
    }

    return this._repository.setActivePointer(orgId, qualify(providerId, version));
  }

  async delete(orgId: string, identifier: string) {
    const pointer = await this._repository.getActivePointer(orgId);
    const active = this.#parseActivePointer(pointer?.activeContentPackIdentifier);
    if (active?.identifier === identifier) {
      await this._repository.setActivePointer(orgId, null);
    }
    const result = await this._repository.delete(orgId, identifier);
    // 1.3a: evict the cached capability for the deleted config.
    this._resolution.invalidate('contentpack', identifier, orgId);
    return result;
  }

  async testConnection(
    orgId: string,
    identifier: string,
    credentials?: Record<string, string>
  ) {
    const { providerId, version } = parseQualified(identifier);
    const meta = this.#meta(providerId);
    if (!meta) {
      throw new Error(`Unknown content pack provider: ${identifier}`);
    }

    let testCredentials = credentials;
    let resolvedVersion = version;

    if (!testCredentials) {
      const config = await this._repository.getByIdentifier(
        orgId,
        providerId,
        version ?? DEFAULT_VERSION
      );
      if (!config) {
        throw new Error(`Content pack "${identifier}" is not configured for this organization`);
      }
      testCredentials = this._decryptCredentials(config.credentials);
      resolvedVersion = version ?? config.version ?? DEFAULT_VERSION;
    }

    if (!testCredentials?.apiKey) {
      throw new Error(`Content pack "${identifier}" is missing credentials`);
    }

    const capability = this._resolution.resolveContentPack(providerId, {
      version: resolvedVersion ?? DEFAULT_VERSION,
      credentials: testCredentials,
      orgId,
    });
    const capabilityName = meta.capabilities[0] || 'photos';
    try {
      const result = await capability.search(capabilityName, 'test', 1);
      return { ok: true, message: 'Connection successful', result };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  #listMeta(): ContentPackMeta[] {
    return this._resolution
      .listManifests('contentpack')
      .map(manifestToContentPackMeta);
  }

  #meta(identifier: string): ContentPackMeta | undefined {
    return this.#listMeta().find((m) => m.identifier === identifier);
  }

  #parseActivePointer(
    raw: string | null | undefined
  ): { identifier: string; version: string } | null {
    if (!raw) return null;
    const { providerId, version } = parseQualified(raw);
    if (!providerId) return null;
    return { identifier: providerId, version: version ?? DEFAULT_VERSION };
  }

  private _decryptCredentials(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(this._encryption.decrypt(encrypted));
    } catch {
      this._logger.warn('Failed to decrypt content pack credentials');
      return {};
    }
  }
}
