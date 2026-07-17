import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class TinyurlAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'tinyurl';
  readonly name = 'TinyURL';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'tinyurl.com';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiToken', label: 'API Token', type: 'password', required: true, placeholder: 'Enter your TinyURL API token' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: false,
    bulkStatistics: false,
    customDomain: true,
  };

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch('https://api.tinyurl.com/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ctx.credentials.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.com/validate' }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { ok: false, error: 'Invalid API token' };
        }
        const body = await response.text();
        return { ok: false, error: `TinyURL API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate TinyURL credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const body: Record<string, any> = { url: originalUrl };
    if (ctx.customDomain) {
      body.domain = ctx.customDomain;
    }
    const response = await this._fetch('https://api.tinyurl.com/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.credentials.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TinyURL create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: data.data?.tiny_url || data.data?.url, providerLinkId: data.data?.id || data.data?.alias };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const response = await this._fetch('https://api.tinyurl.com/expand', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.credentials.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: shortUrl }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TinyURL expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return data.data?.long_url || data.data?.url;
  }
}

const _meta: ShortLinkCapability = new TinyurlAdapter(undefined as unknown as SafeFetchPort);

export const tinyurlShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new TinyurlAdapter(rt.fetch),
};
