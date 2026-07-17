import { SafeFetchPort } from '../ports';

export interface ShortLinkCredentialField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'select';
  required: boolean;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

export interface ShortLinkCapabilities {
  create: boolean;
  expand: boolean;
  statistics: boolean;
  bulkStatistics: boolean;
  customDomain: boolean;
}

export interface ShortLinkContext {
  orgId: string;
  credentials: Record<string, string>;
  customDomain?: string;
  extraConfig?: Record<string, string>;
}

export interface ShortLinkStat {
  short: string;
  original: string;
  clicks: string;
}

export interface ShortLinkOauth {
  authorizeUrl(ctx: ShortLinkContext, state: string, redirectUri: string, codeChallenge?: string): string;
  exchangeCode(code: string, redirectUri: string, ctx: ShortLinkContext, codeVerifier?: string): Promise<Record<string, string>>;
}

export interface ShortLinkCapability {
  readonly identifier: string;
  readonly name: string;
  readonly credentialFields: ShortLinkCredentialField[];
  readonly capabilities: ShortLinkCapabilities;
  readonly authType: 'none' | 'apiKey' | 'oauth2';
  readonly defaultDomain?: string;
  readonly setupNotes?: string;

  resolveDomain(ctx: ShortLinkContext): string;
  validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }>;
  createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }>;
  expandShortLink?(ctx: ShortLinkContext, shortUrl: string): Promise<string>;
  linkStatistics?(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]>;
  listLinks?(ctx: ShortLinkContext, page: number): Promise<ShortLinkStat[]>;
  oauth?: ShortLinkOauth;
}

// ── Short-link adapter base ───────────────────────────────────────────────────
// The 19 short-link adapters copy-paste two bodies: `validateCredentials` (GET an
// auth-protected endpoint, map a non-2xx to an error) and `linkStatistics` (loop the links,
// fetch each click count, swallow per-link failures with a '0' fallback). This base owns both
// over three small abstract hooks the subclass fills in — `_headers` (the provider's auth
// header set), `_validateUrl` (an endpoint whose 2xx proves the credentials), and `_clicksFor`
// (the per-link click count). Provider-specific surface — `resolveDomain`, `createShortLink`,
// and any `expandShortLink`/`listLinks`/`oauth` — stays on the subclass.
export abstract class BaseShortLinkAdapter implements ShortLinkCapability {
  constructor(protected readonly _fetch: SafeFetchPort) {}

  abstract readonly identifier: string;
  abstract readonly name: string;
  abstract readonly credentialFields: ShortLinkCredentialField[];
  abstract readonly capabilities: ShortLinkCapabilities;
  abstract readonly authType: 'none' | 'apiKey' | 'oauth2';
  readonly defaultDomain?: string;
  readonly setupNotes?: string;

  // Auth headers for an authenticated request (Bearer, Api-Key, …).
  protected abstract _headers(ctx: ShortLinkContext): Record<string, string>;
  // An endpoint whose 2xx response proves the credentials are valid.
  protected abstract _validateUrl(ctx: ShortLinkContext): string;
  // Click count for a single short link.
  protected abstract _clicksFor(ctx: ShortLinkContext, shortUrl: string): Promise<number>;

  abstract resolveDomain(ctx: ShortLinkContext): string;
  abstract createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }>;

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch(this._validateUrl(ctx), {
        method: 'GET',
        headers: this._headers(ctx),
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: `${this.name} API error (${response.status}): ${body}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || `Failed to validate ${this.name} credentials` };
    }
  }

  async linkStatistics(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]> {
    const results: ShortLinkStat[] = [];
    for (const link of links) {
      try {
        const clicks = await this._clicksFor(ctx, link);
        results.push({ short: link, original: '', clicks: String(clicks) });
      } catch {
        results.push({ short: link, original: '', clicks: '0' });
      }
    }
    return results;
  }
}
