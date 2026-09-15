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
// Login uses OAuth 2.0 Authorization Code + PKCE (S256) against
// api.twitter.com/2, which is a DIFFERENT credential set from the OAuth 1.0a
// consumer key/secret (X_API_KEY / X_API_SECRET) the social adapter uses for
// channel posting: X issues a separate "OAuth 2.0 Client ID and Client
// Secret" once OAuth 2.0 is enabled in the app's User authentication
// settings, and the consumer key is not accepted as an OAuth 2.0 client_id.
// So this module reads X_CLIENT_ID / X_CLIENT_SECRET (gated by
// X_SSO_ENABLED in AuthProviderManager) and never touches the channel keys.
// DB-config precedence is preserved by reading the AuthProviderRepository
// the AuthProviderManager passes through ctx.extras.

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

// PKCE verifier storage, one slot per login attempt. The frontend proxy
// gates login callbacks on the substring `state=login`, so the per-attempt
// nonce rides along as `state=login.<nonce>`; the callback page posts the
// state back to /auth/oauth/X/exists and getToken reads the verifier once
// (get + del) under that nonce. Matches the repo's `login:` Redis key
// convention (enterprise.controller.ts).
const X_SSO_PKCE_KEY_PREFIX = 'login:x:sso:pkce:';
const X_SSO_PKCE_TTL_SECONDS = 600;
const X_SSO_STATE_PREFIX = 'login.';

export function xSsoPkceKey(nonce: string): string {
  return `${X_SSO_PKCE_KEY_PREFIX}${nonce}`;
}

// `state` → nonce, or null when the state is not one this module issued.
export function xSsoNonceFromState(state?: string | null): string | null {
  if (!state || !state.startsWith(X_SSO_STATE_PREFIX)) return null;
  const nonce = state.slice(X_SSO_STATE_PREFIX.length);
  return /^[A-Za-z0-9_-]{16,}$/.test(nonce) ? nonce : null;
}

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

  const clientId = process.env.X_CLIENT_ID || '';
  const clientSecret = process.env.X_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error(
      'X auth provider is not configured (X_CLIENT_ID / X_CLIENT_SECRET)'
    );
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
    const nonce = randomBytes(16).toString('base64url');

    await redisFrom(this.ctx).set(
      xSsoPkceKey(nonce),
      codeVerifier,
      'EX',
      X_SSO_PKCE_TTL_SECONDS
    );

    return (
      'https://x.com/i/oauth2/authorize' +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(defaultRedirect())}` +
      `&state=${X_SSO_STATE_PREFIX}${nonce}` +
      `&scope=${encodeURIComponent('users.read')}` +
      `&code_challenge=${challenge}` +
      `&code_challenge_method=S256`
    );
  }

  async getToken(
    code: string,
    _redirectUri?: string,
    state?: string
  ): Promise<string> {
    const { clientId, clientSecret } = await resolveConfig(this.ctx);
    const nonce = xSsoNonceFromState(state);
    if (!nonce) {
      throw new Error('X login state missing — restart the login');
    }
    const redis = redisFrom(this.ctx);
    const key = xSsoPkceKey(nonce);
    const codeVerifier = await redis.get(key);
    if (!codeVerifier) {
      throw new Error(
        'X login PKCE verifier missing or expired — restart the login'
      );
    }
    // One-time use: a verifier must never be replayed for a second exchange.
    await redis.del(key);

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
