import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@postmill-ai/provider-kernel';

// Self-contained kernel auth module for Facebook OAuth login (SSO).
//
// Dual-use of the platform channel OAuth app: the same FACEBOOK_APP_ID /
// FACEBOOK_APP_SECRET env vars that power Facebook channel connections also
// log users into Postmill when FACEBOOK_SSO_ENABLED=true. The login flow is a
// separate implementation from the social adapter (same as Google/YouTube) —
// only the env var names are shared. DB-config precedence is preserved by
// reading the AuthProviderRepository the AuthProviderManager passes through
// ctx.extras. Graph API version matches the social adapter (v20.0).

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
  `${process.env.FRONTEND_URL}/integrations/social/facebook`;

async function resolveConfig(ctx: ProviderRuntimeContext): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('FACEBOOK');
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

  const clientId = process.env.FACEBOOK_APP_ID || '';
  const clientSecret = process.env.FACEBOOK_APP_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('Facebook auth provider is not configured');
  }
  return { clientId, clientSecret };
}

class FacebookAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  async generateLink(): Promise<string> {
    const { clientId } = await resolveConfig(this.ctx);
    return (
      'https://www.facebook.com/v20.0/dialog/oauth' +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(defaultRedirect())}` +
      `&state=login` +
      `&scope=public_profile,email`
    );
  }

  async getToken(code: string): Promise<string> {
    const { clientId, clientSecret } = await resolveConfig(this.ctx);
    const { access_token } = await (
      await this.ctx.fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(defaultRedirect())}` +
          `&client_secret=${clientSecret}` +
          `&code=${code}`
      )
    ).json();

    return access_token;
  }

  async getUser(access_token: string): Promise<AuthUserInfo> {
    const userData = await (
      await this.ctx.fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,email,picture&access_token=${access_token}`
      )
    ).json();

    // Facebook returns no email when the user denied the email permission (or
    // signed up with a phone number). Fall back to a synthetic stable address
    // so the account remains identifiable; the `.login.postmill.local` suffix
    // tells downstream flows (newsletter/welcome email) to skip sending.
    const email =
      userData.email || `fb_${userData.id}@facebook.login.postmill.local`;

    return {
      email,
      id: String(userData.id),
      picture: userData.picture?.data?.url || null,
      name: userData.name || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const facebookAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'facebook',
    version: 'v1',
    displayName: 'Facebook',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new FacebookAuthCapability(ctx),
};
