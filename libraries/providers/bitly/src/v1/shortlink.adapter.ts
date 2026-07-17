import { BaseShortLinkAdapter, ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class BitlyAdapter extends BaseShortLinkAdapter {
  readonly identifier = 'bitly';
  readonly name = 'Bitly';
  readonly authType = 'oauth2' as const;
  readonly defaultDomain = 'bit.ly';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'Enter your Bitly OAuth access token' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: true,
    customDomain: true,
  };

  private readonly apiBase = 'https://api-ssl.bitly.com/v4';

  oauth = {
    authorizeUrl: (ctx: ShortLinkContext, state: string, redirectUri: string, codeChallenge?: string): string => {
      const clientId = ctx.extraConfig?.clientId || '';
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
      });
      if (codeChallenge) {
        params.append('code_challenge', codeChallenge);
        params.append('code_challenge_method', 'S256');
      }
      return `https://bitly.com/oauth/authorize?${params.toString()}`;
    },
    exchangeCode: async (code: string, redirectUri: string, ctx: ShortLinkContext, codeVerifier?: string): Promise<Record<string, string>> => {
      const clientId = ctx.extraConfig?.clientId || '';
      const clientSecret = ctx.extraConfig?.clientSecret || '';
      const body: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      };
      if (codeVerifier) {
        body.code_verifier = codeVerifier;
      }
      const response = await this._fetch('https://api-ssl.bitly.com/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Bitly OAuth token exchange failed: ${response.statusText}`);
      }
      const data = await response.json() as Record<string, string>;
      return { accessToken: data.access_token };
    },
  };

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  // Hooks for the base's concrete validateCredentials.
  protected _headers(ctx: ShortLinkContext): Record<string, string> {
    return {
      'Authorization': `Bearer ${ctx.credentials.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  protected _validateUrl(ctx: ShortLinkContext): string {
    return `${this.apiBase}/user`;
  }

  // Canonical per-link click count (base linkStatistics contract). Bitly keeps its own
  // linkStatistics override below to preserve skip-on-non-ok semantics, so this is the
  // single-link helper used when the base's loop is in play.
  protected async _clicksFor(ctx: ShortLinkContext, shortUrl: string): Promise<number> {
    const linkId = shortUrl.replace('https://', '');
    const response = await this._fetch(`${this.apiBase}/bitlinks/${linkId}/clicks/summary`, {
      method: 'GET',
      headers: this._headers(ctx),
    });
    if (!response.ok) throw new Error(`Bitly clicks failed (${response.status})`);
    const data = await response.json() as any;
    return Number(data.total_clicks || 0);
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const domain = this.resolveDomain(ctx);
    const body: Record<string, any> = { long_url: originalUrl, domain };
    if (ctx.customDomain) {
      body.domain = ctx.customDomain;
    }
    const response = await this._fetch(`${this.apiBase}/shorten`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bitly create failed (${response.status}): ${text}`);
    }
    const data = await response.json() as any;
    return { shortUrl: data.link, providerLinkId: data.id };
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const response = await this._fetch(`${this.apiBase}/expand`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bitlink_id: shortUrl }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bitly expand failed (${response.status}): ${text}`);
    }
    const data = await response.json() as any;
    return data.long_url;
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const linkId = link.replace('https://', '');
        const response = await this._fetch(`${this.apiBase}/bitlinks/${linkId}/clicks/summary`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${ctx.credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = await response.json() as any;
          results.push({ short: link, original: '', clicks: String(data.total_clicks || 0) });
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
    const response = await this._fetch(`${this.apiBase}/bitlinks?page=${page}&size=50`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ctx.credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bitly list failed (${response.status}): ${text}`);
    }
    const data = await response.json() as any;
    return (data.links || []).map((link: any) => ({
      short: link.link,
      original: link.long_url || '',
      clicks: '0',
    }));
  }
}

const _meta: ShortLinkCapability = new BitlyAdapter(undefined as unknown as SafeFetchPort);

export const bitlyShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new BitlyAdapter(rt.fetch),
};
