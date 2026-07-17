import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ShortLinkStat, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class LnkifyAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'lnkify';
  readonly name = 'Lnkify';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'lnkify.io';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'lf_live_…' },
    { key: 'baseUrl', label: 'Instance URL (optional)', type: 'string', required: false, placeholder: 'https://lnkify.io' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: true,
    bulkStatistics: false,
    customDomain: true,
  };

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  // Self-hosted instances point the API at their own origin via the baseUrl
  // credential; the SaaS default is https://lnkify.io. GraphQL endpoint, depth limit 5.
  private apiUrl(ctx: ShortLinkContext): string {
    return `${(ctx.credentials.baseUrl || 'https://lnkify.io').replace(/\/+$/, '')}/graphql`;
  }

  // Auth is the `x-api-key` header (keys look like `lf_live_<32 chars>`). A bad key is
  // NOT a 401 — the request runs anonymously and authed resolvers answer HTTP 200 with
  // `data: null` + an auth error message, so GraphQL errors are surfaced from the body.
  private async query(ctx: ShortLinkContext, query: string): Promise<any> {
    const response = await this._fetch(this.apiUrl(ctx), {
      method: 'POST',
      headers: {
        'x-api-key': ctx.credentials.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lnkify API error (${response.status}): ${text}`);
    }
    const payload = (await response.json()) as any;
    if (payload.errors?.length) {
      throw new Error(payload.errors[0].message || 'Lnkify GraphQL error');
    }
    return payload.data;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(this.apiUrl(ctx), {
        method: 'POST',
        headers: {
          'x-api-key': ctx.credentials.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'query { getUserInfo { id } }' }),
      });
      if (response.status === 429) {
        return { ok: false, error: 'Rate limited — retry later' };
      }
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `Lnkify API error (${response.status}): ${body}` };
      }
      const payload = (await response.json()) as any;
      // Valid key ⇒ getUserInfo resolves; invalid/revoked key ⇒ data null + an auth
      // error message ("You need to be authenticated." / "Not authenticated").
      if (payload.data?.getUserInfo?.id) {
        return { ok: true };
      }
      return { ok: false, error: 'Invalid API key' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Lnkify credentials' };
    }
  }

  async createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const domain = this.resolveDomain(ctx);
    // createLnkify returns the SLUG ONLY (String!) — compose the short URL ourselves.
    const data = await this.query(
      ctx,
      `mutation { createLnkify(target: ${JSON.stringify(originalUrl)}, enableTracking: true) }`,
    );
    const slug = data?.createLnkify;
    if (!slug) {
      throw new Error('Lnkify create failed: no slug returned');
    }
    const result: { shortUrl: string; providerLinkId?: string } = { shortUrl: `https://${domain}/${slug}` };
    // Best-effort: resolve the provider link id (needed by linkStatistics) via
    // lnkifyConnection, exact-matching the slug. Never fail a successful create over it.
    try {
      const lookup = await this.query(
        ctx,
        `query { lnkifyConnection(search: ${JSON.stringify(slug)}) { items { id lnkify } } }`,
      );
      const match = (lookup?.lnkifyConnection?.items || []).find((item: any) => item.lnkify === slug);
      if (match?.id) {
        result.providerLinkId = match.id;
      }
    } catch {
      // providerLinkId is optional — omit it on any lookup failure.
    }
    return result;
  }

  async expandShortLink(ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    // The slug is the last path segment; hostname is only sent when the short URL lives
    // on a custom domain (the resolver defaults to the instance host). Public query.
    const parsed = new URL(shortUrl);
    const slug = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const args = [`lnkify: ${JSON.stringify(slug)}`];
    if (parsed.host !== this.defaultDomain) {
      args.push(`hostname: ${JSON.stringify(parsed.host)}`);
    }
    const data = await this.query(ctx, `query { targetUrl(${args.join(', ')}) }`);
    if (!data?.targetUrl) {
      throw new Error('Lnkify: target not found');
    }
    return data.targetUrl;
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    // links are provider link ids (see createShortLink); hitCount is the click counter.
    const results: ShortLinkStat[] = [];
    for (const id of links) {
      try {
        const data = await this.query(
          ctx,
          `query { getLnkifyInfo(id: ${JSON.stringify(id)}) { id lnkify target hitCount } }`,
        );
        const info = data?.getLnkifyInfo;
        if (!info) {
          throw new Error('Lnkify: link not found');
        }
        results.push({
          short: `https://${this.resolveDomain(ctx)}/${info.lnkify}`,
          original: info.target || '',
          clicks: String(info.hitCount ?? '0'),
        });
      } catch {
        // Keep one entry per input (base-class contract) — don't drop the link on failure.
        results.push({ short: id, original: '', clicks: '0' });
      }
    }
    return results;
  }
}

const _meta: ShortLinkCapability = new LnkifyAdapter(undefined as unknown as SafeFetchPort);

export const lnkifyShortlinkModule: ProviderModule<any, any> = {
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
    docsUrl: 'https://docs.lnkify.io',
    setupNotes: _meta.setupNotes,
  },
  create: (rt) => new LnkifyAdapter(rt.fetch),
};
