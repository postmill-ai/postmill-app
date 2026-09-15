import jwt from 'jsonwebtoken';
import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@postmill-ai/provider-kernel';

// Self-contained kernel auth module for Sign in with Apple (SSO only — Apple
// has no channel/media capabilities in Postmill).
//
// Apple-specific wrinkles vs the other OAuth adapters:
// - There is no static client secret: Apple expects a freshly minted ES256
//   JWT signed with the team's .p8 private key (max lifetime 180 days).
// - The email claim is only sent on the user's FIRST consent and is absent
//   when they hide it behind Apple's private relay. Unlike X/Facebook we do
//   NOT mint a synthetic `*.login.postmill.local` address — the registration
//   flow re-prompts for an email instead (see AuthService.checkExists'
//   emailRequired flag).
// - With the `email` scope requested, Apple requires response_mode=form_post,
//   so the callback is a POST form body; a frontend route handler
//   (apps/frontend/src/app/(app)/auth/callback/apple/route.ts) converts it to
//   the standard /auth?code=...&state=login&provider=APPLE flow.
//
// DB-config precedence is preserved by reading the AuthProviderRepository the
// AuthProviderManager passes through ctx.extras. The DB row carries clientId
// (the Services ID) and clientSecret (the base64-encoded .p8 key); the Team
// ID and Key ID have no AuthProviderConfig columns and always come from env.

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

const APPLE_AUDIENCE = 'https://appleid.apple.com';
// Apple's documented maximum lifetime for the client-secret JWT.
const CLIENT_SECRET_TTL_SECONDS = 60 * 60 * 24 * 180;

const defaultRedirect = () => `${process.env.FRONTEND_URL}/auth/callback/apple`;

async function resolveConfig(ctx: ProviderRuntimeContext): Promise<{
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}> {
  const teamId = process.env.APPLE_TEAM_ID || '';
  const keyId = process.env.APPLE_KEY_ID || '';

  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;
  if (repo) {
    try {
      const db = await repo.findByProvider('APPLE');
      if (db?.enabled && db.clientId && db.clientSecret) {
        if (!teamId || !keyId) {
          // Team ID / Key ID have no AuthProviderConfig columns — env only.
          throw new Error('Apple auth provider is not configured');
        }
        return {
          clientId: await ctx.encryption.decrypt(db.clientId),
          privateKey: await ctx.encryption.decrypt(db.clientSecret),
          teamId,
          keyId,
        };
      }
    } catch {
      // fall through to env
    }
  }

  const clientId = process.env.APPLE_CLIENT_ID || '';
  const privateKey = process.env.APPLE_PRIVATE_KEY || '';
  if (!clientId || !teamId || !keyId || !privateKey) {
    throw new Error('Apple auth provider is not configured');
  }
  return { clientId, teamId, keyId, privateKey };
}

// APPLE_PRIVATE_KEY (or the DB clientSecret) is the base64-encoded contents of
// the .p8 file Apple issues for Sign in with Apple — base64 so it survives
// .env / Docker Compose round-trips without newline mangling.
function decodePrivateKey(privateKey: string): string {
  return Buffer.from(privateKey, 'base64').toString('utf8');
}

function mintClientSecret(config: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}): string {
  return jwt.sign({}, decodePrivateKey(config.privateKey), {
    algorithm: 'ES256',
    issuer: config.teamId,
    audience: APPLE_AUDIENCE,
    subject: config.clientId,
    expiresIn: CLIENT_SECRET_TTL_SECONDS,
    keyid: config.keyId,
  });
}

class AppleAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  async generateLink(): Promise<string> {
    const { clientId } = await resolveConfig(this.ctx);
    return (
      'https://appleid.apple.com/auth/authorize' +
      `?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(defaultRedirect())}` +
      `&response_type=code` +
      `&response_mode=form_post` +
      `&scope=email` +
      `&state=login`
    );
  }

  async getToken(code: string): Promise<string> {
    const config = await resolveConfig(this.ctx);
    const { id_token } = await (
      await this.ctx.fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.clientId,
          client_secret: mintClientSecret(config),
          redirect_uri: defaultRedirect(),
        }).toString(),
      })
    ).json();

    return id_token;
  }

  // The token returned by getToken is Apple's id_token (a JWT), obtained over
  // TLS straight from appleid.apple.com during the code exchange — decoding
  // the payload is sufficient, no JWKS round-trip. Apple only ships the
  // user's name in the first-consent `user` form field, which we deliberately
  // do not thread through, so `name` stays empty.
  async getUser(idToken: string): Promise<AuthUserInfo | false> {
    const payload = jwt.decode(idToken) as {
      sub?: string;
      email?: string;
    } | null;
    if (!payload?.sub) {
      return false;
    }

    return {
      id: String(payload.sub),
      email: payload.email || undefined,
      name: '',
    };
  }

  async postRegistration(): Promise<void> {}
}

export const appleAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'apple',
    version: 'v1',
    displayName: 'Apple',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new AppleAuthCapability(ctx),
};
