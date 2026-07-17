import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class CuttlyAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'cuttly';
  readonly name = 'Cutt.ly';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'cutt.ly';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'Enter your Cutt.ly API key' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: false,
    customDomain: false,
  };

  private readonly apiBase = 'https://cutt.ly/api/api.php';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(`${this.apiBase}?key=${ctx.credentials.apiKey}&short=https://example.com/validate`, {
        method: 'GET',
      });
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: `Cutt.ly HTTP ${response.status}: ${text.slice(0, 200)}` };
      }
      const data = (await response.json()) as any;
      if (data?.url?.status === 7 || data?.url?.status === 3) {
        return { ok: true };
      }
      if (data?.url?.status === 4) {
        return { ok: false, error: 'Invalid Cutt.ly API key' };
      }
      return { ok: false, error: `Cutt.ly API error (status: ${data?.url?.status})` };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Cutt.ly credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const params = new URLSearchParams({ key: ctx.credentials.apiKey, short: originalUrl });
    const response = await this._fetch(`${this.apiBase}?${params.toString()}`, {
      method: 'GET',
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cutt.ly create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    if (data?.url?.status !== 7) {
      throw new Error(`Cutt.ly create failed: ${data?.url?.title || 'Unknown error'} (status: ${data?.url?.status})`);
    }
    return { shortUrl: data.url.shortLink, providerLinkId: data.url.code || data.url.hash };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const params = new URLSearchParams({ key: ctx.credentials.apiKey, short: shortUrl });
    const response = await this._fetch(`${this.apiBase}?${params.toString()}`, {
      method: 'GET',
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cutt.ly expand failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return data?.url?.fullLink || data?.url?.long_url || '';
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const params = new URLSearchParams({ key: ctx.credentials.apiKey, short: link });
        const response = await this._fetch(`${this.apiBase}?${params.toString()}`, {
          method: 'GET',
        });
        if (response.ok) {
          const data = (await response.json()) as any;
          if (data?.url) {
            results.push({ short: link, original: data.url.fullLink || '', clicks: String(data.url.clicks || '0') });
          }
        }
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }
}

const _meta: ShortLinkCapability = new CuttlyAdapter(undefined as unknown as SafeFetchPort);

export const cuttlyShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new CuttlyAdapter(rt.fetch),
};
