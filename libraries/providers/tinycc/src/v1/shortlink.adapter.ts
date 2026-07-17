import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class TinyccAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'tinycc';
  readonly name = 'Tiny.cc';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'tiny.cc';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'login', label: 'Login / Username', type: 'string', required: true, placeholder: 'Your Tiny.cc account username' },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Your Tiny.cc API key' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: false,
    customDomain: false,
  };

  private readonly apiBase = 'https://tiny.cc/api';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const params = new URLSearchParams({
        login: ctx.credentials.login,
        apiKey: ctx.credentials.apiKey,
        url: 'https://example.com/validate',
      });
      const response = await this._fetch(`${this.apiBase}/shorten?${params.toString()}`, { method: 'GET' });
      const data = (await response.json()) as any;
      if (data?.error?.code === '0' || data?.error?.msg === 'ok') {
        return { ok: true };
      }
      return { ok: false, error: `Tiny.cc error: ${data?.error?.msg || 'Unknown error'} (code: ${data?.error?.code})` };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Tiny.cc credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const params = new URLSearchParams({
      login: ctx.credentials.login,
      apiKey: ctx.credentials.apiKey,
      url: originalUrl,
    });
    const response = await this._fetch(`${this.apiBase}/shorten?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tiny.cc create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (data?.error?.code !== '0') {
      throw new Error(`Tiny.cc create failed: ${data?.error?.msg || 'Unknown error'}`);
    }
    return { shortUrl: data.shortUrl || data.url?.shortLink, providerLinkId: data.hash || data.code };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const params = new URLSearchParams({
      login: ctx.credentials.login,
      apiKey: ctx.credentials.apiKey,
      short: shortUrl,
    });
    const response = await this._fetch(`${this.apiBase}/expand?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tiny.cc expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (data?.error?.code !== '0') {
      throw new Error(`Tiny.cc expand failed: ${data?.error?.msg || 'Unknown error'}`);
    }
    return data.url || data.long_url || '';
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const params = new URLSearchParams({
          login: ctx.credentials.login,
          apiKey: ctx.credentials.apiKey,
          short: link,
        });
        const response = await this._fetch(`${this.apiBase}/stats?${params.toString()}`, { method: 'GET' });
        if (response.ok) {
          const data = (await response.json()) as any;
          results.push({ short: link, original: data.url || data.long_url || '', clicks: String(data.clicks || data.link_clicks || '0') });
        }
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }
}

const _meta: ShortLinkCapability = new TinyccAdapter(undefined as unknown as SafeFetchPort);

export const tinyccShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new TinyccAdapter(rt.fetch),
};
