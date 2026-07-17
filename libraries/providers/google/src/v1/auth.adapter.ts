import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@gitroom/provider-kernel';
import { google } from 'googleapis';

import { metadata as providerMetadata } from './metadata';

// S-17 / known proxy gap: the googleapis SDK creates its own Gaxios/OAuth2 HTTP
// clients and does not expose a hook that accepts an undici Dispatcher. The
// per-channel VPN dispatcher used by SocialAbstract.fetch() (via
// getVpnDispatcher()) therefore cannot be applied to Google OAuth token or
// userinfo calls. The hosts are fixed first-party Google endpoints, so SSRF risk
// is low; the gap is specifically per-channel VPN egress. Closing it would
// require a custom Gaxios adapter/fetchImplementation that translates
// GaxiosOptions into undici requests with the active dispatcher.

// Self-contained kernel auth module for Google (YouTube) OAuth login. Mirrors
// the legacy apps/backend google.provider.ts DB-first → env-fallback precedence;
// the legacy class is kept for the PROVIDER_KERNEL=legacy decorator path. DB
// config is read via the AuthProviderRepository the AuthProviderManager passes
// through ctx.extras (so this library never imports apps/backend).

interface AuthProviderConfigRow {
  enabled?: boolean | null;
  clientId?: string | null;
  clientSecret?: string | null;
}

interface AuthProviderRepoLike {
  findByProvider(
    provider: string,
    version?: string,
  ): Promise<AuthProviderConfigRow | null>;
}

const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/integrations/social/youtube`;

async function resolveConfig(ctx: ProviderRuntimeContext): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('GOOGLE');
      if (db?.enabled && db.clientId && db.clientSecret) {
        return {
          clientId: await ctx.encryption.decrypt(db.clientId),
          clientSecret: await ctx.encryption.decrypt(db.clientSecret),
        };
      }
    } catch {
      // fall through to env
    }
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID || '';
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('Google auth provider is not configured');
  }
  return { clientId, clientSecret };
}

class GoogleAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  private async makeClient(redirectUri: string) {
    const { clientId, clientSecret } = await resolveConfig(this.ctx);
    return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
  }

  async generateLink(query?: { redirect_uri?: string }): Promise<string> {
    const redirectUri = query?.redirect_uri || defaultRedirect();
    const client = await this.makeClient(redirectUri);
    return client.generateAuthUrl({
      access_type: 'online',
      prompt: 'consent',
      state: 'login',
      redirect_uri: redirectUri,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
  }

  async getToken(code: string, redirectUri?: string): Promise<string> {
    const client = await this.makeClient(redirectUri || defaultRedirect());
    const { tokens } = await client.getToken(code);
    return tokens.access_token!;
  }

  async getUser(providerToken: string): Promise<AuthUserInfo> {
    const client = await this.makeClient(defaultRedirect());
    client.setCredentials({ access_token: providerToken });
    const { data } = await google
      .oauth2({ version: 'v2', auth: client })
      .userinfo.get();

    return {
      id: data.id!,
      email: data.email!,
      picture: data.picture || null,
      name: data.name || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const googleAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'google',
    version: 'v1',
    displayName: 'Google',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new GoogleAuthCapability(ctx),
};
