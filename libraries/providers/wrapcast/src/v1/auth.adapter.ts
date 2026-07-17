import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@gitroom/provider-kernel';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';

import { metadata as providerMetadata } from './metadata';
// Self-contained kernel auth module for Farcaster (Neynar) login. Lives in the
// `wrapcast` package (which also ships the Farcaster social adapter) but the auth
// providerId is `farcaster` to match the Prisma Provider enum. The legacy
// apps/backend farcaster.provider.ts is kept for the PROVIDER_KERNEL=legacy
// decorator path. DB config (Neynar API key in clientId) is read via the
// AuthProviderRepository the AuthProviderManager passes through ctx.extras.

interface AuthProviderConfigRow {
  enabled?: boolean | null;
  clientId?: string | null;
}

interface AuthProviderRepoLike {
  findByProvider(
    provider: string,
    version?: string,
  ): Promise<AuthProviderConfigRow | null>;
}

async function resolveApiKey(ctx: ProviderRuntimeContext): Promise<string> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('FARCASTER');
      if (db?.enabled && db.clientId) {
        const apiKey = await ctx.encryption.decrypt(db.clientId);
        if (apiKey) {
          return apiKey;
        }
      }
    } catch {
      // fall through to env
    }
  }

  const apiKey = process.env.NEYNAR_SECRET_KEY || '';
  if (!apiKey) {
    throw new Error('Farcaster auth provider is not configured');
  }
  return apiKey;
}

class FarcasterAuthCapability implements AuthCapability {
  private _client: NeynarAPIClient | undefined;

  constructor(private readonly ctx: ProviderRuntimeContext) {}

  private async getClient(): Promise<NeynarAPIClient> {
    if (!this._client) {
      const apiKey = await resolveApiKey(this.ctx);
      this._client = new NeynarAPIClient({ apiKey });
    }
    return this._client;
  }

  generateLink(): string {
    return '';
  }

  async getToken(code: string): Promise<string> {
    const client = await this.getClient();
    const data = JSON.parse(Buffer.from(code, 'base64').toString());
    const status = await client.lookupSigner({ signerUuid: data.signer_uuid });
    if (status.status === 'approved') {
      return data.signer_uuid;
    }
    return '';
  }

  async getUser(providerToken: string): Promise<AuthUserInfo> {
    if (!providerToken) {
      return { id: '', email: '' };
    }

    const client = await this.getClient();
    const status = await client.lookupSigner({ signerUuid: providerToken });
    if (status.status !== 'approved') {
      return { id: '', email: '' };
    }

    const { display_name, displayName } = status as typeof status & {
      display_name?: string;
      displayName?: string;
    };

    return {
      id: String('farcaster_' + status.fid),
      email: String('farcaster_' + status.fid),
      name: display_name || displayName || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const wrapcastAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'farcaster',
    version: 'v1',
    displayName: 'Farcaster',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new FarcasterAuthCapability(ctx),
};
