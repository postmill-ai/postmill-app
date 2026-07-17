import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class T2mAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 't2m';
  readonly name = 'T2M';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 't2m.io';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiToken', label: 'API Token', type: 'password', required: true, placeholder: 'Enter your T2M API token' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private readonly apiBase = 'https://t2m.io/api';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  private headers(ctx: ShortLinkContext): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.credentials.apiToken}`,
    };
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(`${this.apiBase}/v1/links?limit=1`, {
        method: 'GET',
        headers: this.headers(ctx),
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `T2M API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate T2M credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const body: Record<string, any> = { url: originalUrl };
    if (ctx.customDomain) {
      body.domain = ctx.customDomain;
    }
    const response = await this._fetch(`${this.apiBase}/v1/links`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`T2M create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: data.short_url || data.link || data.url, providerLinkId: data.id || data.slug };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const response = await this._fetch(`${this.apiBase}/v1/links/expand`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: JSON.stringify({ url: shortUrl }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`T2M expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return data.url || data.destination || data.original_url || '';
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const response = await this._fetch(`${this.apiBase}/v1/links/stats`, {
          method: 'POST',
          headers: this.headers(ctx),
          body: JSON.stringify({ url: link }),
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          results.push({ short: link, original: data.url || data.destination || '', clicks: String(data.clicks || data.click_count || '0') });
        }
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }

  async listLinks(ctx: ShortLinkContext, page: number): Promise<ShortLinkStat[]> {
    const response = await this._fetch(`${this.apiBase}/v1/links?page=${page}&limit=50`, {
      method: 'GET',
      headers: this.headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`T2M list failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    const links = Array.isArray(data) ? data : data.links || data.data || [];
    return links.map((link: any) => ({
      short: link.short_url || link.link || link.url,
      original: link.url || link.destination || link.original_url || '',
      clicks: String(link.clicks || link.click_count || '0'),
    }));
  }
}

const _meta: ShortLinkCapability = new T2mAdapter(undefined as unknown as SafeFetchPort);

export const t2mShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new T2mAdapter(rt.fetch),
};
