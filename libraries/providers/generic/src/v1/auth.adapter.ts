import { metadata as providerMetadata } from './metadata';
import {
  ProviderModule,
  ProviderRuntimeContext,
  AuthCapability,
  AuthUserInfo,
} from '@gitroom/provider-kernel';

// Self-contained kernel auth module for the GENERIC / OIDC login provider.
// Mirrors the legacy apps/backend oauth.provider.ts DB-first → env-fallback
// precedence; the legacy class is kept for the PROVIDER_KERNEL=legacy decorator
// path. DB config is read via the AuthProviderRepository the AuthProviderManager
// passes through ctx.extras (so this library never imports apps/backend).

interface AuthProviderConfigRow {
  enabled?: boolean | null;
  clientId?: string | null;
  clientSecret?: string | null;
  authUrl?: string | null;
  tokenUrl?: string | null;
  userInfoUrl?: string | null;
  scopes?: string | null;
  displayName?: string | null;
}

interface AuthProviderRepoLike {
  findByProvider(
    provider: string,
    version?: string,
  ): Promise<AuthProviderConfigRow | null>;
}

interface ResolvedOidcConfig {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string;
  displayName: string;
  frontendUrl: string;
}

function getEnvConfig(): ResolvedOidcConfig | null {
  const clientId = process.env.POSTMILL_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.POSTMILL_OAUTH_CLIENT_SECRET || '';
  const {
    POSTMILL_OAUTH_AUTH_URL: authUrl,
    POSTMILL_OAUTH_TOKEN_URL: tokenUrl,
    POSTMILL_OAUTH_USERINFO_URL: userInfoUrl,
    FRONTEND_URL: frontendUrl,
  } = process.env;

  if (
    !userInfoUrl ||
    !tokenUrl ||
    !clientId ||
    !clientSecret ||
    !authUrl ||
    !frontendUrl
  ) {
    return null;
  }

  return {
    authUrl,
    clientId,
    clientSecret,
    tokenUrl,
    userInfoUrl,
    scopes: 'openid profile email',
    displayName: 'OIDC',
    frontendUrl,
  };
}

async function resolveConfig(
  ctx: ProviderRuntimeContext,
): Promise<ResolvedOidcConfig> {
  const repo = (ctx.extras as { authProviderRepo?: AuthProviderRepoLike })
    ?.authProviderRepo;

  let db: AuthProviderConfigRow | null = null;
  if (repo) {
    try {
      db = await repo.findByProvider('GENERIC');
    } catch {
      db = null;
    }
  }

  if (db?.enabled && db.authUrl && db.tokenUrl && db.userInfoUrl) {
    const clientId = db.clientId ? await ctx.encryption.decrypt(db.clientId) : '';
    const clientSecret = db.clientSecret
      ? await ctx.encryption.decrypt(db.clientSecret)
      : '';
    return {
      authUrl: db.authUrl,
      clientId,
      clientSecret,
      tokenUrl: db.tokenUrl,
      userInfoUrl: db.userInfoUrl,
      scopes: db.scopes || 'openid profile email',
      displayName: db.displayName || 'OIDC',
      frontendUrl: process.env.FRONTEND_URL || '',
    };
  }

  const envConfig = getEnvConfig();
  if (envConfig) {
    return envConfig;
  }

  throw new Error('GENERIC/OIDC auth provider is not configured');
}

class OidcAuthCapability implements AuthCapability {
  constructor(private readonly ctx: ProviderRuntimeContext) {}

  async generateLink(): Promise<string> {
    const config = await resolveConfig(this.ctx);
    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes,
      response_type: 'code',
      redirect_uri: `${config.frontendUrl}/settings`,
    });
    return `${config.authUrl}?${params.toString()}`;
  }

  async getToken(code: string): Promise<string> {
    const config = await resolveConfig(this.ctx);
    const response = await this.ctx.fetch(`${config.tokenUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: `${config.frontendUrl}/settings`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${error}`);
    }

    const { access_token } = await response.json();
    return access_token;
  }

  async getUser(access_token: string): Promise<AuthUserInfo> {
    const config = await resolveConfig(this.ctx);
    const response = await this.ctx.fetch(`${config.userInfoUrl}`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`User info request failed: ${error}`);
    }

    const data = (await response.json()) as {
      email: string;
      sub?: string;
      id?: string;
      picture?: string | null;
      name?: string | null;
    };

    return {
      email: data.email,
      id: data.sub || data.id || '',
      picture: data.picture || null,
      name: data.name || null,
    };
  }

  async postRegistration(): Promise<void> {}
}

export const genericAuthModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'auth',
    providerId: 'generic',
    version: 'v1',
    displayName: 'OIDC',
    status: 'active',
    credentialFields: [],
    capabilities: {},
    authType: 'oauth2',
  },
  create: (ctx) => new OidcAuthCapability(ctx),
};
