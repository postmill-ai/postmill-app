import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class LinklyAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'linkly';
  readonly name = 'Linkly';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'linklyhq.com';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Enter your Linkly API key' },
    { key: 'workspaceId', label: 'Workspace ID', type: 'string', required: true, placeholder: 'Your Linkly workspace ID' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private readonly apiBase = 'https://app.linklyhq.com/api';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  private headers(ctx: ShortLinkContext): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.credentials.apiKey}`,
      'X-Workspace-ID': ctx.credentials.workspaceId,
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
        return { ok: false, error: `Linkly API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Linkly credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const domain = this.resolveDomain(ctx);
    const body: Record<string, any> = { url: originalUrl, domain };
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
      throw new Error(`Linkly create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: data.short_url || data.link, providerLinkId: data.id || data.short_code };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const response = await this._fetch(`${this.apiBase}/v1/links/expand`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: JSON.stringify({ url: shortUrl }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Linkly expand failed (${response.status}): ${text}`);
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
          results.push({ short: link, original: data.destination_url || data.url || '', clicks: String(data.clicks || data.click_count || '0') });
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
      throw new Error(`Linkly list failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    const links = Array.isArray(data) ? data : data.links || data.data || [];
    return links.map((link: any) => ({
      short: link.short_url || link.link,
      original: link.url || link.destination_url || link.original_url || '',
      clicks: String(link.clicks || link.click_count || '0'),
    }));
  }
}

const _meta: ShortLinkCapability = new LinklyAdapter(undefined as unknown as SafeFetchPort);

export const linklyShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new LinklyAdapter(rt.fetch),
};
