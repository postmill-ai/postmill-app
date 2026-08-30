import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@postmill-ai/provider-kernel';

// Self-contained kernel auth module for LinkedIn OAuth login (SSO).
//
// Dual-use of the platform channel OAuth app: the same LINKEDIN_CLIENT_ID /
// LINKEDIN_CLIENT_SECRET env vars that power LinkedIn channel connections also
// log users into Postmill when LINKEDIN_SSO_ENABLED=true. The login flow is a
// separate implementation from the social adapter (same as Google/YouTube) —
// only the env var names are shared. Uses LinkedIn's OpenID Connect flow
// (openid/profile/email scopes + /v2/userinfo). DB-config precedence is
// preserved by reading the AuthProviderRepository the AuthProviderManager
// passes through ctx.extras.

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
  `${process.env.FRONTEND_URL}/integrations/social/linkedin`;

async function resolveConfig(ctx: ProviderRuntimeContext): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('LINKEDIN');
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

  const clientId = process.env.LINKEDIN_CLIENT_ID || '';
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn auth provider is not configured');
  }
  return { clientId, clientSecret };
}

class LinkedinAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  async generateLink(): Promise<string> {
    const { clientId } = await resolveConfig(this.ctx);
    return (
      'https://www.linkedin.com/oauth/v2/authorization' +
      `?response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(defaultRedirect())}` +
      `&state=login` +
      `&scope=openid%20profile%20email`
    );
  }

  async getToken(code: string): Promise<string> {
    const { clientId, clientSecret } = await resolveConfig(this.ctx);
    const { access_token } = await (
      await this.ctx.fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: defaultRedirect(),
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      })
    ).json();

    return access_token;
  }

  async getUser(access_token: string): Promise<AuthUserInfo> {
    const userData = await (
      await this.ctx.fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      })
    ).json();

    // OIDC userinfo: `sub` is the stable subject identifier.
    return {
      email: userData.email,
      id: String(userData.sub),
      picture: userData.picture || null,
      name: userData.name || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const linkedinAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'linkedin',
    version: 'v1',
    displayName: 'LinkedIn',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new LinkedinAuthCapability(ctx),
};
