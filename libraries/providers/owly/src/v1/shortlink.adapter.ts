import { ShortLinkCapability, ShortLinkCredentialField, ShortLinkCapabilities, ShortLinkContext, ProviderModule, SafeFetchPort } from '@gitroom/provider-kernel';

import { metadata as providerMetadata } from './metadata';
export class OwlyAdapter implements ShortLinkCapability {
  constructor(private readonly _fetch: SafeFetchPort) {}

  readonly identifier = 'owly';
  readonly name = 'Ow.ly';
  readonly authType = 'apiKey' as const;
  readonly defaultDomain = 'ow.ly';
  readonly setupNotes = 'Ow.ly creation and stats are not supported via public API. Short links must be created via the Hootsuite dashboard. This adapter validates Hootsuite credentials only.';
  readonly credentialFields: ShortLinkCredentialField[] = [
    { key: 'hootsuiteToken', label: 'Hootsuite Token', type: 'password', required: true, placeholder: 'Enter your Hootsuite API token for Ow.ly' },
  ];
  readonly capabilities: ShortLinkCapabilities = {
    create: false,
    expand: false,
    statistics: false,
    bulkStatistics: false,
    customDomain: false,
  };

  resolveDomain(_ctx: ShortLinkContext): string {
    return this.defaultDomain;
  }

  async validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this._fetch('https://api.hootsuite.com/1/auth/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: ctx.credentials.hootsuiteToken,
        }).toString(),
      });
      if (response.ok) {
        return { ok: true };
      }
      return { ok: false, error: `Ow.ly token validation failed (${response.status})` };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to validate Ow.ly/Hootsuite credentials' };
    }
  }

  async createShortLink(_ctx: ShortLinkContext, _originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }> {
    throw new Error('Ow.ly short link creation is not supported via public API');
  }
}

const _meta: ShortLinkCapability = new OwlyAdapter(undefined as unknown as SafeFetchPort);

export const owlyShortlinkModule: ProviderModule<any, any> = {
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
  create: (rt) => new OwlyAdapter(rt.fetch),
};
