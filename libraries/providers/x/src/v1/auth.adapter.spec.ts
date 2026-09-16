import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { xAuthModule, xSsoNonceFromState, xSsoPkceKey } from './auth.adapter';

const ORIGINAL_ENV = { ...process.env };

function mockResponse(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
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
  process.env.X_CLIENT_ID = 'x-oauth2-client-id';
  process.env.X_CLIENT_SECRET = 'x-oauth2-client-secret';
  // Channel (OAuth 1.0a) keys must never be picked up by the login adapter.
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
    it('builds the X OAuth2 authorize URL with PKCE S256 and a per-attempt state=login.<nonce>', async () => {
      const redis = makeRedis();
      const { ctx } = makeCtx({ extras: { redis } });

      const link = await xAuthModule.create(ctx).generateLink();

      const [key, verifier, ex, ttl] = redis.set.mock.calls[0];
      expect(key).toMatch(/^login:x:sso:pkce:[A-Za-z0-9_-]{16,}$/);
      expect(typeof verifier).toBe('string');
      expect(verifier.length).toBeGreaterThan(40);
      expect(ex).toBe('EX');
      expect(ttl).toBe(600);

      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');

      const url = new URL(link);
      expect(url.origin + url.pathname).toBe(
        'https://x.com/i/oauth2/authorize'
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      // OAuth 2.0 client id — never the OAuth 1.0a consumer key
      expect(url.searchParams.get('client_id')).toBe('x-oauth2-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/integrations/social/x'
      );
      const state = url.searchParams.get('state')!;
      // the frontend proxy gates login callbacks on the substring state=login
      expect(state.startsWith('login')).toBe(true);
      const nonce = xSsoNonceFromState(state)!;
      expect(nonce).toBeTruthy();
      expect(key).toBe(xSsoPkceKey(nonce));
      // users/me needs tweet.read + users.read; users.email → confirmed_email
      expect(url.searchParams.get('scope')).toBe(
        'tweet.read users.read users.email'
      );
      expect(url.searchParams.get('code_challenge')).toBe(challenge);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('throws when Redis is not available in ctx.extras', async () => {
      const { ctx } = makeCtx({ extras: {} });

      await expect(xAuthModule.create(ctx).generateLink()).rejects.toThrow(
        'X auth provider requires Redis'
      );
    });

    it('issues a fresh nonce + verifier slot per login attempt (no shared slot)', async () => {
      const redis = makeRedis();
      const { ctx } = makeCtx({ extras: { redis } });
      const auth = xAuthModule.create(ctx);

      const a = new URL(await auth.generateLink()).searchParams.get('state');
      const b = new URL(await auth.generateLink()).searchParams.get('state');

      expect(a).not.toBe(b);
      expect(redis.set.mock.calls[0][0]).not.toBe(redis.set.mock.calls[1][0]);
    });

    it('throws when neither DB config nor env creds are present — the channel keys alone do not count', async () => {
      delete process.env.X_CLIENT_ID;
      delete process.env.X_CLIENT_SECRET;
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

      const token = await xAuthModule
        .create(ctx)
        .getToken('code-123', undefined, 'login.abcdefghijklmnop');

      expect(token).toBe('x-token');
      expect(redis.get).toHaveBeenCalledWith('login:x:sso:pkce:abcdefghijklmnop');
      // one-time use: verifier deleted after the exchange
      expect(redis.del).toHaveBeenCalledWith('login:x:sso:pkce:abcdefghijklmnop');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.twitter.com/2/oauth2/token');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      );
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from(
          'x-oauth2-client-id:x-oauth2-client-secret'
        ).toString('base64')}`
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

    it('surfaces the X error body when the exchange is rejected', async () => {
      const redis = makeRedis();
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(
          { error: 'invalid_client', error_description: 'Client not found' },
          400
        )
      );
      const { ctx } = makeCtx({ fetch: fetchMock, extras: { redis } });

      await expect(
        xAuthModule
          .create(ctx)
          .getToken('code-123', undefined, 'login.abcdefghijklmnop')
      ).rejects.toThrow('X token exchange failed: Client not found');
    });

    it('throws when a 200 carries no access_token', async () => {
      const redis = makeRedis();
      const fetchMock = vi.fn().mockResolvedValue(mockResponse({}));
      const { ctx } = makeCtx({ fetch: fetchMock, extras: { redis } });

      await expect(
        xAuthModule
          .create(ctx)
          .getToken('code-123', undefined, 'login.abcdefghijklmnop')
      ).rejects.toThrow('X token exchange failed: HTTP 200');
    });

    it('throws when the PKCE verifier is missing or expired', async () => {
      const redis = makeRedis({ get: vi.fn().mockResolvedValue(null) });
      const { ctx } = makeCtx({ extras: { redis } });

      await expect(
        xAuthModule
          .create(ctx)
          .getToken('code-123', undefined, 'login.abcdefghijklmnop')
      ).rejects.toThrow('PKCE verifier missing or expired');
    });

    it.each([undefined, '', 'login', 'login.', 'login.short', 'evil.abcdefghijklmnop'])(
      'rejects a callback without a state this module issued (%s)',
      async (state) => {
        const redis = makeRedis();
        const { ctx } = makeCtx({ extras: { redis } });

        await expect(
          xAuthModule.create(ctx).getToken('code-123', undefined, state as any)
        ).rejects.toThrow('X login state missing');
        expect(redis.get).not.toHaveBeenCalled();
      }
    );
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
      expect(url).toContain('confirmed_email');
      expect(init.headers.Authorization).toBe('Bearer x-token');
      expect(user).toEqual({
        email: 'x_456@x.login.postmill.local',
        id: '456',
        picture: 'https://pic.example.com/ann.jpg',
        name: 'Ann Example',
      });
    });

    it('uses confirmed_email when the users.email scope returns one', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse({
          data: {
            id: '456',
            name: 'Ann Example',
            username: 'annexample',
            confirmed_email: 'ann@example.com',
          },
        })
      );
      const { ctx } = makeCtx({ fetch: fetchMock });

      const user = await xAuthModule.create(ctx).getUser('x-token');

      expect(user.email).toBe('ann@example.com');
      expect(user.picture).toBeNull();
    });

    it('surfaces the X error when users/me is rejected (e.g. missing tweet.read)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse(
          {
            title: 'Forbidden',
            detail: 'Your client app is not configured with the appropriate scopes',
            status: 403,
          },
          403
        )
      );
      const { ctx } = makeCtx({ fetch: fetchMock });

      await expect(
        xAuthModule.create(ctx).getUser('x-token')
      ).rejects.toThrow(
        'X profile lookup failed: Your client app is not configured with the appropriate scopes'
      );
    });

    it('treats a 200 without data as a failure instead of crashing on data.id', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockResponse({ errors: [{ message: 'Unknown user' }] }));
      const { ctx } = makeCtx({ fetch: fetchMock });

      await expect(
        xAuthModule.create(ctx).getUser('x-token')
      ).rejects.toThrow('X profile lookup failed: Unknown user');
    });
  });
});
