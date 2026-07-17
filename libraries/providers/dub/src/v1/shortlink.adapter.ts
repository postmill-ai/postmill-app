import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class DubAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'dub';
  readonly name = 'Dub.co';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'dub.sh';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'token', label: 'API Token', type: 'password', required: true, placeholder: 'Enter your Dub.co API token (dub_...)' },
    { key: 'apiEndpoint', label: 'API Endpoint', type: 'string', required: false, placeholder: 'https://api.dub.co' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private apiBase(ctx: ShortLinkContext): string {
    return ctx.credentials.apiEndpoint || 'https://api.dub.co';
  }

  private headers(ctx: ShortLinkContext): Record<string, string> {
    return {
      'Authorization': `Bearer ${ctx.credentials.token}`,
      'Content-Type': 'application/json',
    };
  }

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(`${this.apiBase(ctx)}/links?page=1&pageSize=1`, {
        method: 'GET',
        headers: this.headers(ctx),
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Dub.co API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Dub.co credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const domain = this.resolveDomain(ctx);
    const body: Record<string, any> = { url: originalUrl, domain };
    const response = await this._fetch(`${this.apiBase(ctx)}/links`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Dub.co create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: data.shortLink || data.url, providerLinkId: data.id };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const response = await this._fetch(`${this.apiBase(ctx)}/links/info?url=${encodeURIComponent(shortUrl)}`, {
      method: 'GET',
      headers: this.headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Dub.co expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return data.url || data.destinationUrl || '';
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const response = await this._fetch(`${this.apiBase(ctx)}/links/info?url=${encodeURIComponent(link)}`, {
          method: 'GET',
          headers: this.headers(ctx),
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          results.push({ short: data.shortLink || link, original: data.url || '', clicks: String(data.clicks || data.timeseries?.length || '0') });
        } else {
          // Keep one entry per input (base-class contract) — don't drop the link on a non-2xx.
          results.push({ short: link, original: '', clicks: '0' });
        }
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }

  async listLinks(ctx: ShortLinkContext, page: number): Promise<ShortLinkStat[]> {
    const response = await this._fetch(`${this.apiBase(ctx)}/links?page=${page}&pageSize=50`, {
      method: 'GET',
      headers: this.headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Dub.co list failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    const links = Array.isArray(data) ? data : data.links || data.data || [];
    return links.map((link: any) => ({
      short: link.shortLink || link.url,
      original: link.url || link.destinationUrl || '',
      clicks: String(link.clicks || '0'),
    }));
  }
}

const _meta: ShortLinkCapability = new DubAdapter(undefined as unknown as SafeFetchPort);

export const dubShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new DubAdapter(rt.fetch),
};
