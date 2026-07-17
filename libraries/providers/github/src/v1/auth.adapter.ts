import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@gitroom/provider-kernel';

// Self-contained kernel auth module for GitHub OAuth login.
//
// The legacy class (apps/backend/.../auth/providers/github.provider.ts) is kept
// for the PROVIDER_KERNEL=legacy decorator path; this package re-implements the
// same logic against the kernel AuthCapability contract so a library never
// imports apps/backend. DB-config precedence is preserved by reading the
// AuthProviderRepository the AuthProviderManager passes through ctx.extras.

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

async function resolveConfig(ctx: ProviderRuntimeContext): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('GITHUB');
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

  const clientId = process.env.GITHUB_CLIENT_ID || '';
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('GitHub auth provider is not configured');
  }
  return { clientId, clientSecret };
}

class GithubAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  async generateLink(): Promise<string> {
    const { clientId } = await resolveConfig(this.ctx);
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email&redirect_uri=${encodeURIComponent(
      `${process.env.FRONTEND_URL}/settings`,
    )}`;
  }

  async getToken(code: string): Promise<string> {
    const { clientId, clientSecret } = await resolveConfig(this.ctx);
    const { access_token } = await (
      await this.ctx.fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${process.env.FRONTEND_URL}/settings`,
        }),
      })
    ).json();

    return access_token;
  }

  async getUser(access_token: string): Promise<AuthUserInfo> {
    const [userData, emailsData] = await Promise.all([
      (
        await this.ctx.fetch('https://api.github.com/user', {
          headers: { Authorization: `token ${access_token}` },
        })
      ).json(),
      (
        await this.ctx.fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `token ${access_token}` },
        })
      ).json(),
    ]);

    const { email } = emailsData[0];

    return {
      email,
      id: String(userData.id),
      picture: userData.avatar_url || null,
      name: userData.name || userData.login || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const githubAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'github',
    version: 'v1',
    displayName: 'GitHub',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new GithubAuthCapability(ctx),
};
