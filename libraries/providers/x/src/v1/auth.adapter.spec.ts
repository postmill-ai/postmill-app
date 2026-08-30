import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { xAuthModule } from './auth.adapter';

const ORIGINAL_ENV = { ...process.env };

function mockResponse(body: any) {
  return { json: async () => body } as any;
}

function makeRedis(overrides?: Partial<{
  set: any;
  get: any;
  del: any;
}>) {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue('stored-verifier'),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

function makeCtx(overrides?: { fetch?: any; extras?: any }) {
  const fetchMock = overrides?.fetch ?? vi.fn();
  const ctx = {
    credentials: {},
    encryption: {
      encrypt: async (v: string) => `enc:${v}`,
      decrypt: async (v: string) => v.replace(/^enc:/, ''),
    },
    fetch: fetchMock,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    telemetry: { recordCall: vi.fn() },
    extras: overrides?.extras ?? { redis: makeRedis() },
  } as any;
  return { ctx, fetchMock };
}

function setEnv() {
  process.env.FRONTEND_URL = 'https://app.example.com';
  process.env.X_API_KEY = 'x-api-key';
  process.env.X_API_SECRET = 'x-api-secret';
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('xAuthModule', () => {
  it('exposes the auth manifest shape', () => {
    expect(xAuthModule.manifest).toMatchObject({
      domain: 'auth',
      providerId: 'x',
      version: 'v1',
      status: 'active',
      authType: 'oauth2',
    });
  });

  describe('generateLink', () => {
    it('builds the X OAuth2 authorize URL with PKCE S256 and state=login', async () => {
      const redis = makeRedis();
      const { ctx } = makeCtx({ extras: { redis } });

      const link = await xAuthModule.create(ctx).generateLink();

      const [key, verifier, ex, ttl] = redis.set.mock.calls[0];
      expect(key).toBe('login:x:sso:pkce');
      expect(typeof verifier).toBe('string');
      expect(verifier.length).toBeGreaterThan(40);
      expect(ex).toBe('EX');
      expect(ttl).toBe(600);

      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');

      const url = new URL(link);
      expect(url.origin + url.pathname).toBe(
        'https://twitter.com/i/oauth2/authorize'
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('x-api-key');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/integrations/social/x'
      );
      expect(url.searchParams.get('state')).toBe('login');
      expect(url.searchParams.get('scope')).toBe('users.read');
      expect(url.searchParams.get('code_challenge')).toBe(challenge);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('throws when Redis is not available in ctx.extras', async () => {
      const { ctx } = makeCtx({ extras: {} });

      await expect(xAuthModule.create(ctx).generateLink()).rejects.toThrow(
        'X auth provider requires Redis'
      );
    });

    it('throws when neither DB config nor env creds are present', async () => {
      delete process.env.X_API_KEY;
      delete process.env.X_API_SECRET;
      const { ctx } = makeCtx();

      await expect(xAuthModule.create(ctx).generateLink()).rejects.toThrow(
        'X auth provider is not configured'
      );
    });

    it('prefers an enabled DB config over env creds (decrypts secrets)', async () => {
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: true,
        clientId: 'enc:db-api-key',
        clientSecret: 'enc:db-api-secret',
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider }, redis: makeRedis() },
      });

      const link = await xAuthModule.create(ctx).generateLink();

      expect(findByProvider).toHaveBeenCalledWith('X');
      expect(new URL(link).searchParams.get('client_id')).toBe('db-api-key');
    });
  });

  describe('getToken', () => {
    it('exchanges the code with the stored PKCE verifier (Basic auth, form body)', async () => {
      const redis = makeRedis();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockResponse({ access_token: 'x-token' }));
      const { ctx } = makeCtx({ fetch: fetchMock, extras: { redis } });

      const token = await xAuthModule.create(ctx).getToken('code-123');

      expect(token).toBe('x-token');
      expect(redis.get).toHaveBeenCalledWith('login:x:sso:pkce');
      // one-time use: verifier deleted after the exchange
      expect(redis.del).toHaveBeenCalledWith('login:x:sso:pkce');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.twitter.com/2/oauth2/token');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      );
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from('x-api-key:x-api-secret').toString('base64')}`
      );
      expect(init.body).toContain('grant_type=authorization_code');
      expect(init.body).toContain('code=code-123');
      expect(init.body).toContain('code_verifier=stored-verifier');
      expect(init.body).toContain(
        `redirect_uri=${encodeURIComponent(
          'https://app.example.com/integrations/social/x'
        )}`
      );
    });

    it('throws when the PKCE verifier is missing or expired', async () => {
      const redis = makeRedis({ get: vi.fn().mockResolvedValue(null) });
      const { ctx } = makeCtx({ extras: { redis } });

      await expect(xAuthModule.create(ctx).getToken('code-123')).rejects.toThrow(
        'PKCE verifier missing or expired'
      );
    });
  });

  describe('getUser', () => {
    it('maps the users/me response and synthesizes a stable email (X returns none)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse({
          data: {
            id: '456',
            name: 'Ann Example',
            username: 'annexample',
            profile_image_url: 'https://pic.example.com/ann.jpg',
          },
        })
      );
      const { ctx } = makeCtx({ fetch: fetchMock });

      const user = await xAuthModule.create(ctx).getUser('x-token');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('https://api.twitter.com/2/users/me');
      expect(init.headers.Authorization).toBe('Bearer x-token');
      expect(user).toEqual({
        email: 'x_456@x.login.postmill.local',
        id: '456',
        picture: 'https://pic.example.com/ann.jpg',
        name: 'Ann Example',
      });
    });
  });
});
