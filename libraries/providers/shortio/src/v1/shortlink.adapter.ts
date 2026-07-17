import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class ShortioAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'shortio';
  readonly name = 'Short.io';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'short.io';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'secretKey', label: 'Secret Key', type: 'password', required: true, placeholder: 'Enter your Short.io secret key' },
    { key: 'domain', label: 'Short Domain', type: 'string', required: true, placeholder: 'e.g. short.io' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private readonly apiBase = 'https://api.short.io';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || ctx.credentials.domain || this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(`${this.apiBase}/api/links`, {
        method: 'GET',
        headers: {
          'Authorization': ctx.credentials.secretKey,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Short.io API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Short.io credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    // Honour the org's configured customDomain (capabilities.customDomain: true) — was ignored.
    const domain = this.resolveDomain(ctx);
    const body: Record<string, any> = {
      originalURL: originalUrl,
      domain,
    };
    const response = await this._fetch(`${this.apiBase}/api/links`, {
      method: 'POST',
      headers: {
        'Authorization': ctx.credentials.secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Short.io create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    // SPECULATIVE (needs a live key): prefer the API's canonical `shortURL`. Short.io
    // returns it as a full short URL — use it directly when it looks like one, else
    // compose from the resolved domain + id/path.
    const shortUrl =
      typeof data.shortURL === 'string' && /^https?:\/\//.test(data.shortURL)
        ? data.shortURL
        : `https://${domain}/${data.shortURL || data.idString || data.path}`;
    return { shortUrl, providerLinkId: data.idString || data.id };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const path = shortUrl.replace(/https?:\/\//, '');
    const response = await this._fetch(`${this.apiBase}/api/links/expand`, {
      method: 'POST',
      headers: {
        'Authorization': ctx.credentials.secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ shortURL: path }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Short.io expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return data.originalURL || data.long_url || '';
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const path = link.replace(/https?:\/\//, '');
        const response = await this._fetch(`${this.apiBase}/api/links/${encodeURIComponent(path)}`, {
          method: 'GET',
          headers: {
            'Authorization': ctx.credentials.secretKey,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          results.push({
            short: `https://${data.domain || this.defaultDomain}/${data.idString || data.path}`,
            original: data.originalURL || '',
            clicks: String(data.clicks || '0'),
          });
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
    const response = await this._fetch(`${this.apiBase}/api/links?page=${page}&limit=50`, {
      method: 'GET',
      headers: {
        'Authorization': ctx.credentials.secretKey,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Short.io list failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    const links = Array.isArray(data) ? data : data.links || [];
    return links.map((link: any) => ({
      short: `https://${link.domain || this.defaultDomain}/${link.idString || link.path}`,
      original: link.originalURL || '',
      clicks: String(link.clicks || '0'),
    }));
  }
}

const _meta: ShortLinkCapability = new ShortioAdapter(undefined as unknown as SafeFetchPort);

export const shortioShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new ShortioAdapter(rt.fetch),
};
