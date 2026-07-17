import { BaseShortLinkAdapter, ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class BlinkAdapter extends BaseShortLinkAdapter {
  readonly identifier = 'blink';
  readonly name = 'BL.INK';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'bl.ink';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Enter your BL.INK API key' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private readonly apiBase = 'https://api.bl.ink';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  protected _headers(ctx: ShortLinkContext): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': ctx.credentials.apiKey,
    };
  }

  // Endpoint whose 2xx proves the credentials (base validateCredentials).
  protected _validateUrl(ctx: ShortLinkContext): string {
    return `${this.apiBase}/api/v1/links?limit=1`;
  }

  // Canonical per-link click count (base linkStatistics contract). BL.INK keeps its own
  // linkStatistics override below to preserve skip-on-non-ok semantics and the `original` field.
  protected async _clicksFor(ctx: ShortLinkContext, shortUrl: string): Promise<number> {
    const slug = shortUrl.replace(/https?:\/\//, '').split('/').pop() || '';
    const response = await this._fetch(`${this.apiBase}/api/v1/link/${encodeURIComponent(slug)}/analytics`, {
      method: 'GET',
      headers: this._headers(ctx),
    });
    if (!response.ok) throw new Error(`BL.INK analytics failed (${response.status})`);
    const data = (await response.json()) as any;
    return Number(data.clicks || data.total_clicks || 0);
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const domain = this.resolveDomain(ctx);
    const body: Record<string, any> = { url: originalUrl, domain };
    if (ctx.customDomain) {
      body.domain = ctx.customDomain;
    }
    const response = await this._fetch(`${this.apiBase}/api/v1/links`, {
      method: 'POST',
      headers: this._headers(ctx),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BL.INK create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: `https://${domain}/${data.slug || data.id}`, providerLinkId: data.id || data.slug };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const slug = shortUrl.replace(/https?:\/\//, '').split('/').pop() || '';
    const response = await this._fetch(`${this.apiBase}/api/v1/link/${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: this._headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BL.INK expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return data.url || data.destination || '';
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const slug = link.replace(/https?:\/\//, '').split('/').pop() || '';
        const response = await this._fetch(`${this.apiBase}/api/v1/link/${encodeURIComponent(slug)}/analytics`, {
          method: 'GET',
          headers: this._headers(ctx),
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          results.push({ short: link, original: data.url || data.destination || '', clicks: String(data.clicks || data.total_clicks || '0') });
        }
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }

  async listLinks(ctx: ShortLinkContext, page: number): Promise<ShortLinkStat[]> {
    const response = await this._fetch(`${this.apiBase}/api/v1/links?limit=50&offset=${(page - 1) * 50}`, {
      method: 'GET',
      headers: this._headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BL.INK list failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    const links = Array.isArray(data) ? data : data.links || data.data || [];
    return links.map((link: any) => ({
      short: `${link.domain ? `https://${link.domain}` : this.defaultDomain}/${link.slug || link.id}`,
      original: link.url || link.destination || '',
      clicks: String(link.clicks || link.total_clicks || '0'),
    }));
  }
}

const _meta: ShortLinkCapability = new BlinkAdapter(undefined as unknown as SafeFetchPort);

export const blinkShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new BlinkAdapter(rt.fetch),
};
