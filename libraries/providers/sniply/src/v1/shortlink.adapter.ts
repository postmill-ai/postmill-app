import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class SniplyAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'sniply';
  readonly name = 'Sniply';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'snip.ly';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiToken', label: 'API Token', type: 'password', required: true, placeholder: 'Enter your Sniply API token' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: false,
    statistics: false,
    bulkStatistics: false,
    customDomain: true,
  };

  private readonly apiBase = 'https://api.snip.ly';

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(`${this.apiBase}/v1/account`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${ctx.credentials.apiToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Sniply API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Sniply credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const body: Record<string, any> = { url: originalUrl };
    if (ctx.customDomain) {
      body.domain = ctx.customDomain;
    }
    const response = await this._fetch(`${this.apiBase}/v1/links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.credentials.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Sniply create failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as any;
    return { shortUrl: data.short_url || data.link, providerLinkId: data.id || data.slug };
  }
}

const _meta: ShortLinkCapability = new SniplyAdapter(undefined as unknown as SafeFetchPort);

export const sniplyShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new SniplyAdapter(rt.fetch),
};
