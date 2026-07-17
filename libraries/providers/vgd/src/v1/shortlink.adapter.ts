import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class VgdAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'vgd';
  readonly name = 'v.gd';
  readonly authType = 'none' as const;
  readonly defaultDomain = 'v.gd';
  readonly credentialFields: ShortLinkCredentialField[] = [];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: false,
    bulkStatistics: false,
    customDomain: false,
  };

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(_ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async createShortLink(_ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const params = new URLSearchParams({ format: 'json', url: originalUrl });
    const response = await this._fetch(`https://v.gd/create.php?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`v.gd create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (data.errorcode) {
      throw new Error(`v.gd create failed: ${data.errormessage || data.error}`);
    }
    return { shortUrl: data.shorturl || data.url };
  }

  async expandShortLink(_ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const params = new URLSearchParams({ format: 'json', shorturl: shortUrl });
    const response = await this._fetch(`https://v.gd/forward.php?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`v.gd expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (data.errorcode) {
      throw new Error(`v.gd expand failed: ${data.errormessage || data.error}`);
    }
    return data.url || '';
  }
}

const _meta: ShortLinkCapability = new VgdAdapter(undefined as unknown as SafeFetchPort);

export const vgdShortlinkModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'shortlink',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: _meta.credentialFields as any,
    capabilities: _meta.capabilities,
    authType: _meta.authType,
    defaultDomain: _meta.defaultDomain,
    setupNotes: _meta.setupNotes,
  },
  create: (rt) => new VgdAdapter(rt.fetch),
};
