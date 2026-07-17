import { Injectable, Logger } from '@nestjs/common';
import { ProviderConfigRepository } from './provider-config.repository';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ProviderConfiguration } from '@prisma/client';

export interface ProviderCatalogListItem {
  identifier: string;
  name: string;
  description: string;
  enabled: boolean;
  isConfigured: boolean;
  setupInstructions: string;
  additionalConfig: string;
  isExternal: boolean;
  isWeb3: boolean;
  isChromeExtension: boolean;
  customFields: boolean;
  scopes: string;
}

export interface ProviderCatalogEntry {
  identifier: string;
  name: string;
  enabled: boolean;
  redirectUri: string;
  scopes: string;
  setupInstructions: string;
  isConfigured: boolean;
  additionalConfig: string;
  isExternal: boolean;
  isWeb3: boolean;
  isChromeExtension: boolean;
  customFields: boolean;
}

@Injectable()
export class ProviderConfigService {
  private readonly _logger = new Logger(ProviderConfigService.name);

  constructor(private _repository: ProviderConfigRepository) {}

  getAll() {
    return this._repository.getAll();
  }

  getByIdentifier(identifier: string) {
    return this._repository.getByIdentifier(identifier);
  }

  getEnabled() {
    return this._repository.getEnabled();
  }

  async upsert(
    identifier: string,
    data: {
      name: string;
      enabled: boolean;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      scopes?: string;
      additionalConfig?: string;
      setupInstructions?: string;
    }
  ) {
    const encryptedClientId =
      data.clientId !== undefined && data.clientId !== null && data.clientId !== ''
        ? AuthService.fixedEncryption(data.clientId)
        : (data.clientId === null || data.clientId === '') ? null : undefined;
    const encryptedClientSecret =
      data.clientSecret !== undefined && data.clientSecret !== null && data.clientSecret !== ''
        ? AuthService.fixedEncryption(data.clientSecret)
        : (data.clientSecret === null || data.clientSecret === '') ? null : undefined;

    return this._repository.upsert(identifier, {
      ...data,
      clientId: encryptedClientId,
      clientSecret: encryptedClientSecret,
    });
  }

  delete(identifier: string) {
    return this._repository.delete(identifier);
  }

  decryptConfig(config: ProviderConfiguration): {
    clientId?: string;
    clientSecret?: string;
  } {
    return {
      clientId: config.clientId
        ? AuthService.fixedDecryption(config.clientId)
        : undefined,
      clientSecret: config.clientSecret
        ? AuthService.fixedDecryption(config.clientSecret)
        : undefined,
    };
  }

  private _isConfigured(config: ProviderConfiguration): boolean {
    try {
      const d = this.decryptConfig(config);
      return !!(d.clientId || d.clientSecret);
    } catch (err) {
      this._logger.warn(
        `Failed to decrypt config for ${config.identifier}, treating as unconfigured: ${
          (err as Error)?.message ?? String(err)
        }`
      );
      return false;
    }
  }

  async getProviderCatalog(
    providers: Array<{
      identifier: string;
      name: string;
      toolTip?: string;
      externalUrl?: string | ((url: string) => any);
      isWeb3?: boolean;
      isChromeExtension?: boolean;
      customFields?: boolean | (() => any);
      scopes?: string[];
    }>
  ): Promise<ProviderCatalogListItem[]> {
    const dbConfigs = await this.getAll();
    const dbConfigMap = new Map(dbConfigs.map((c) => [c.identifier, c]));

    return providers.map((p) => {
      const dbConfig = dbConfigMap.get(p.identifier);
      return {
        identifier: p.identifier,
        name: p.name,
        description: p.toolTip || '',
        enabled: dbConfig?.enabled || false,
        isConfigured: dbConfig ? this._isConfigured(dbConfig) : false,
        setupInstructions: dbConfig?.setupInstructions || '',
        additionalConfig: dbConfig?.additionalConfig || '',
        isExternal: !!p.externalUrl,
        isWeb3: !!p.isWeb3,
        isChromeExtension: !!p.isChromeExtension,
        customFields: !!p.customFields,
        scopes: p.scopes?.join(', ') || '',
      };
    });
  }

  async getProviderCatalogEntry(
    identifier: string,
    providers: Array<{
      identifier: string;
      name: string;
      toolTip?: string;
      externalUrl?: string | ((url: string) => any);
      isWeb3?: boolean;
      isChromeExtension?: boolean;
      customFields?: boolean | (() => any);
      scopes?: string[];
    }>
  ): Promise<ProviderCatalogEntry> {
    const config = await this.getByIdentifier(identifier);
    const provider = providers.find((p) => p.identifier === identifier);

    return {
      identifier,
      name: provider?.name || identifier,
      enabled: config?.enabled || false,
      redirectUri: config?.redirectUri || '',
      scopes: config?.scopes || provider?.scopes?.join(', ') || '',
      setupInstructions: config?.setupInstructions || '',
      isConfigured: config ? this._isConfigured(config) : false,
      additionalConfig: config?.additionalConfig || '',
      isExternal: !!provider?.externalUrl,
      isWeb3: !!provider?.isWeb3,
      isChromeExtension: !!provider?.isChromeExtension,
      customFields: !!provider?.customFields,
    };
  }
}
