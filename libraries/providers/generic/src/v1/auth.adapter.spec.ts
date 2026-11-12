import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { genericAuthModule } from './auth.adapter';

const ORIGINAL_ENV = { ...process.env };

function makeCtx(extras: any = {}) {
  return {
    credentials: {},
    encryption: {
      encrypt: async (v: string) => `enc:${v}`,
      decrypt: async (v: string) => v.replace(/^enc:/, ''),
    },
    fetch: vi.fn(),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    telemetry: { recordCall: vi.fn() },
    extras,
  } as any;
}

async function scopeOf(ctx = makeCtx()) {
  const link = await genericAuthModule.create(ctx).generateLink();
  return new URL(link).searchParams.get('scope');
}

beforeEach(() => {
  process.env.FRONTEND_URL = 'https://app.example.com';
  process.env.POSTMILL_OAUTH_CLIENT_ID = 'oidc-id';
  process.env.POSTMILL_OAUTH_CLIENT_SECRET = 'oidc-secret';
  process.env.POSTMILL_OAUTH_AUTH_URL = 'https://idp.example.com/authorize';
  process.env.POSTMILL_OAUTH_TOKEN_URL = 'https://idp.example.com/token';
  process.env.POSTMILL_OAUTH_USERINFO_URL = 'https://idp.example.com/userinfo';
  delete process.env.POSTMILL_OAUTH_SCOPE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('genericAuthModule env bootstrap scopes', () => {
  it('defaults to "openid profile email" when POSTMILL_OAUTH_SCOPE is unset', async () => {
    expect(await scopeOf()).toBe('openid profile email');
  });

  it('defaults when POSTMILL_OAUTH_SCOPE is blank', async () => {
    process.env.POSTMILL_OAUTH_SCOPE = '   ';
    expect(await scopeOf()).toBe('openid profile email');
  });

  it('requests the trimmed POSTMILL_OAUTH_SCOPE as a space-separated scope param', async () => {
    process.env.POSTMILL_OAUTH_SCOPE = '  openid email groups offline_access ';
    const link = await genericAuthModule.create(makeCtx()).generateLink();
    expect(link).toContain('scope=openid+email+groups+offline_access');
    expect(new URL(link).searchParams.get('scope')).toBe(
      'openid email groups offline_access',
    );
  });

  it('DB-managed scopes still win over POSTMILL_OAUTH_SCOPE', async () => {
    process.env.POSTMILL_OAUTH_SCOPE = 'openid env-scope';
    const repo = {
      findByProvider: vi.fn().mockResolvedValue({
        enabled: true,
        clientId: 'enc:db-id',
        clientSecret: 'enc:db-secret',
        authUrl: 'https://db-idp.example.com/authorize',
        tokenUrl: 'https://db-idp.example.com/token',
        userInfoUrl: 'https://db-idp.example.com/userinfo',
        scopes: 'openid db-scope',
      }),
    };
    expect(await scopeOf(makeCtx({ authProviderRepo: repo }))).toBe(
      'openid db-scope',
    );
  });
});
