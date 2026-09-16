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
//
// Scopes: GET /2/users/me requires BOTH `tweet.read` and `users.read` (X's
// OpenAPI: `OAuth2UserToken: users.read, tweet.read`) — with users.read alone
// the profile lookup 403s and the login dies. `users.email` (OAuth 2.0 email
// support, 2025) adds `confirmed_email` to the response when the X app has
// "Request email from users" enabled in its User authentication settings.

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
// See the header: users/me needs tweet.read + users.read; users.email opts
// into confirmed_email.
export const X_SSO_SCOPES = ['tweet.read', 'users.read', 'users.email'];

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

// X error bodies are JSON too, but never let a non-JSON body mask the status.
async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

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
      `&scope=${encodeURIComponent(X_SSO_SCOPES.join(' '))}` +
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

    const response = await this.ctx.fetch(
      'https://api.twitter.com/2/oauth2/token',
      {
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
      }
    );
    const body = await readJson(response);
    // X answers failures with { error, error_description } — surface them
    // instead of letting an undefined token 500 further down.
    if (!response.ok || !body?.access_token) {
      throw new Error(
        `X token exchange failed: ${
          body?.error_description || body?.error || `HTTP ${response.status}`
        }`
      );
    }

    return body.access_token as string;
  }

  async getUser(access_token: string): Promise<AuthUserInfo> {
    const response = await this.ctx.fetch(
      'https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username,confirmed_email',
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );
    const body = await readJson(response);
    // Errors come back as { title, detail, status } (or an `errors` array);
    // a missing `data` is the same failure (e.g. insufficient scopes).
    const data = body?.data;
    if (!response.ok || !data?.id) {
      const first = body?.errors?.[0];
      throw new Error(
        `X profile lookup failed: ${
          body?.detail ||
          body?.title ||
          first?.message ||
          first?.title ||
          `HTTP ${response.status}`
        }`
      );
    }

    // `confirmed_email` arrives only with the users.email scope AND the app's
    // "Request email from users" permission; otherwise synthesize a stable
    // address from the user id so the account remains identifiable. The
    // `.login.postmill.local` suffix tells downstream flows
    // (newsletter/welcome email) to skip sending.
    return {
      email: data.confirmed_email || `x_${data.id}@x.login.postmill.local`,
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
