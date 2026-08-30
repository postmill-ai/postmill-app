import { createHash, randomBytes } from 'crypto';
import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@postmill-ai/provider-kernel';

// Self-contained kernel auth module for X (Twitter) OAuth login (SSO).
//
// Dual-use of the platform channel OAuth app: the same X_API_KEY /
// X_API_SECRET env vars that power X channel connections also log users into
// Postmill when X_SSO_ENABLED=true. The login flow is a separate
// implementation from the social adapter (which uses OAuth 1.0a) — login uses
// OAuth 2.0 with PKCE (S256) against api.twitter.com/2. Only the env var
// names are shared. DB-config precedence is preserved by reading the
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

interface RedisLike {
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

// PKCE verifier storage. The login `state` must be the literal "login" (the
// frontend proxy gates OAuth callbacks on `state=login`), and only the `code`
// query param flows back into getToken — so the verifier cannot be correlated
// per request and is stashed under one fixed key with a short TTL, read
// once (get + del) at token exchange. Trade-off: two simultaneous X logins
// race on the single slot; the loser simply retries. Matches the repo's
// `login:` Redis key convention (enterprise.controller.ts).
const X_SSO_PKCE_KEY = 'login:x:sso:pkce';
const X_SSO_PKCE_TTL_SECONDS = 600;

const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/integrations/social/x`;

function redisFrom(ctx: ProviderRuntimeContext): RedisLike {
  const redis = (ctx.extras as { redis?: RedisLike })?.redis;
  if (!redis) {
    throw new Error('X auth provider requires Redis (PKCE verifier store)');
  }
  return redis;
}

async function resolveConfig(ctx: ProviderRuntimeContext): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('X');
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

  const clientId = process.env.X_API_KEY || '';
  const clientSecret = process.env.X_API_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('X auth provider is not configured');
  }
  return { clientId, clientSecret };
}

class XAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  async generateLink(): Promise<string> {
    const { clientId } = await resolveConfig(this.ctx);

    // PKCE (S256), same construction as the VK social adapter.
    const codeVerifier = randomBytes(64).toString('base64url');
    const challenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    await redisFrom(this.ctx).set(
      X_SSO_PKCE_KEY,
      codeVerifier,
      'EX',
      X_SSO_PKCE_TTL_SECONDS
    );

    return (
      'https://twitter.com/i/oauth2/authorize' +
      `?response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(defaultRedirect())}` +
      `&state=login` +
      `&scope=${encodeURIComponent('users.read')}` +
      `&code_challenge=${challenge}` +
      `&code_challenge_method=S256`
    );
  }

  async getToken(code: string): Promise<string> {
    const { clientId, clientSecret } = await resolveConfig(this.ctx);
    const redis = redisFrom(this.ctx);
    const codeVerifier = await redis.get(X_SSO_PKCE_KEY);
    if (!codeVerifier) {
      throw new Error(
        'X login PKCE verifier missing or expired — restart the login'
      );
    }
    // One-time use: a verifier must never be replayed for a second exchange.
    await redis.del(X_SSO_PKCE_KEY);

    const { access_token } = await (
      await this.ctx.fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: defaultRedirect(),
          code_verifier: codeVerifier,
        }).toString(),
      })
    ).json();

    return access_token;
  }

  async getUser(access_token: string): Promise<AuthUserInfo> {
    const { data } = await (
      await this.ctx.fetch(
        'https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username',
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      )
    ).json();

    // X's users.read scope returns NO email address — synthesize a stable one
    // from the user id so the account remains identifiable. The
    // `.login.postmill.local` suffix tells downstream flows
    // (newsletter/welcome email) to skip sending.
    return {
      email: `x_${data.id}@x.login.postmill.local`,
      id: String(data.id),
      picture: data.profile_image_url || null,
      name: data.name || data.username || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const xAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'x',
    version: 'v1',
    displayName: 'X',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new XAuthCapability(ctx),
};
