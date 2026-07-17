import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class CleanuriAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'cleanuri';
  readonly name = 'CleanURI';
  readonly authType = 'none' as const;
  readonly defaultDomain = 'cleanuri.com';
  readonly credentialFields: ShortLinkCredentialField[] = [];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: false,
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
    const params = new URLSearchParams({ url: originalUrl });
    const response = await this._fetch('https://cleanuri.com/api/v1/shorten', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CleanURI create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (data.error) {
      throw new Error(`CleanURI create failed: ${data.error}`);
    }
    return { shortUrl: data.result_url || data.short_url || data.link };
  }
}

const _meta: ShortLinkCapability = new CleanuriAdapter(undefined as unknown as SafeFetchPort);

export const cleanuriShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new CleanuriAdapter(rt.fetch),
};
