import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class RebrandlyAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'rebrandly';
  readonly name = 'Rebrandly';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'rebrand.ly';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Enter your Rebrandly API key' },
    { key: 'workspace', label: 'Workspace ID (optional)', type: 'string', required: false, placeholder: 'Leave blank for primary workspace' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private readonly apiBase = 'https://api.rebrandly.com/v1';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  private headers(ctx: ShortLinkContext): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': ctx.credentials.apiKey,
    };
    if (ctx.credentials.workspace) {
      headers['workspace'] = ctx.credentials.workspace;
    }
    return headers;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(`${this.apiBase}/account`, {
        method: 'GET',
        headers: this.headers(ctx),
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Rebrandly API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Rebrandly credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const domain = this.resolveDomain(ctx);
    const body: Record<string, any> = {
      destination: originalUrl,
      domain: { fullName: domain },
    };
    const response = await this._fetch(`${this.apiBase}/links`, {
      method: 'POST',
      headers: this.headers(ctx),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Rebrandly create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: data.shortUrl, providerLinkId: data.id };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const response = await this._fetch(`${this.apiBase}/links?slashtag=${encodeURIComponent(shortUrl.replace(/https?:\/\//, '').split('/').pop() || '')}`, {
      method: 'GET',
      headers: this.headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Rebrandly expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (Array.isArray(data) && data.length > 0) {
      return data[0].destination || '';
    }
    throw new Error('Rebrandly: link not found');
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const slashtag = link.replace(/https?:\/\//, '').split('/').pop() || '';
        const response = await this._fetch(`${this.apiBase}/links?slashtag=${encodeURIComponent(slashtag)}`, {
          method: 'GET',
          headers: this.headers(ctx),
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          if (Array.isArray(data) && data.length > 0) {
            results.push({ short: link, original: data[0].destination || '', clicks: String(data[0].clicks || '0') });
          }
        }
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }

  async listLinks(ctx: ShortLinkContext, page: number): Promise<ShortLinkStat[]> {
    const response = await this._fetch(`${this.apiBase}/links?limit=50&skip=${(page - 1) * 50}`, {
      method: 'GET',
      headers: this.headers(ctx),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Rebrandly list failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return (Array.isArray(data) ? data : []).map((link: any) => ({
      short: link.shortUrl,
      original: link.destination || '',
      clicks: String(link.clicks || '0'),
    }));
  }
}

const _meta: ShortLinkCapability = new RebrandlyAdapter(undefined as unknown as SafeFetchPort);

export const rebrandlyShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new RebrandlyAdapter(rt.fetch),
};
