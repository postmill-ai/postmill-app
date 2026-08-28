import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ProviderModule, SafeFetchPort } from '@postmill-ai/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class IsgdAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'isgd';
  readonly name = 'is.gd';
  readonly authType = 'none' as const;
  readonly defaultDomain = 'is.gd';
  readonly credentialFields: ShortLinkCredentialField[] = [];
  readonly capabilities: ShortLinkCapabilities = {
    create: true,
    expand: true,
    statistics: false,
    bulkStatistics: false,
    customDomain: false,
  };

  resolveDomain(ctx: ShortLinkContext): string {
    return ctx.customDomain || this.defaultDomain;
  }

  async validateCredentials(_ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async createShortLink(_ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    const params = new URLSearchParams({ format: 'json', url: originalUrl });
    const response = await this._fetch(`https://is.gd/create.php?${params.toString()}`, { method: 'GET' });
    const data = await parseIsgdResponse(response, 'create');
    if (data.errorcode) {
      throw new Error(`is.gd create failed: ${data.errormessage || data.error}`);
    }
    return { shortUrl: data.shorturl || data.url };
  }

  async expandShortLink(_ctx: ShortLinkContext, shortUrl: string): Promise<string> {
    const params = new URLSearchParams({ format: 'json', shorturl: shortUrl });
    const response = await this._fetch(`https://is.gd/forward.php?${params.toString()}`, { method: 'GET' });
    const data = await parseIsgdResponse(response, 'expand');
    if (data.errorcode) {
      throw new Error(`is.gd expand failed: ${data.errormessage || data.error}`);
    }
    return data.url || '';
  }
}

const _meta: ShortLinkCapability = new IsgdAdapter(undefined as unknown as SafeFetchPort);

// is.gd answers failures with HTTP 200 + a plain-text "Error, …" body (seen
// live 2026-08-28: "Error, database insert failed" — their service was down),
// so read text first and surface it instead of a bare JSON parse error.
async function parseIsgdResponse(response: any, action: string): Promise<any> {
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!response.ok || data === undefined || data === null) {
    throw new Error(`is.gd ${action} failed (${response.status}): ${text}`);
  }
  return data;
}

export const isgdShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new IsgdAdapter(rt.fetch),
};
