import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { facebookAuthModule } from './auth.adapter';

const ORIGINAL_ENV = { ...process.env };

function mockResponse(body: any) {
  return { json: async () => body } as any;
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
    extras: overrides?.extras ?? {},
  } as any;
  return { ctx, fetchMock };
}

function setEnv() {
  process.env.FRONTEND_URL = 'https://app.example.com';
  process.env.FACEBOOK_APP_ID = 'fb-app-id';
  process.env.FACEBOOK_APP_SECRET = 'fb-app-secret';
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('facebookAuthModule', () => {
  it('exposes the auth manifest shape', () => {
    expect(facebookAuthModule.manifest).toMatchObject({
      domain: 'auth',
      providerId: 'facebook',
      version: 'v1',
      status: 'active',
      authType: 'oauth2',
    });
  });

  describe('generateLink', () => {
    it('builds the Facebook dialog URL with state=login from env creds', async () => {
      const { ctx } = makeCtx();
      const link = await facebookAuthModule.create(ctx).generateLink();

      expect(link).toBe(
        'https://www.facebook.com/v20.0/dialog/oauth' +
          `?client_id=fb-app-id` +
          `&redirect_uri=${encodeURIComponent(
            'https://app.example.com/integrations/social/facebook'
          )}` +
          `&state=login` +
          `&scope=public_profile,email`
      );
    });

    it('throws when neither DB config nor env creds are present', async () => {
      delete process.env.FACEBOOK_APP_ID;
      delete process.env.FACEBOOK_APP_SECRET;
      const { ctx } = makeCtx();

      await expect(
        facebookAuthModule.create(ctx).generateLink()
      ).rejects.toThrow('Facebook auth provider is not configured');
    });

    it('prefers an enabled DB config over env creds (decrypts secrets)', async () => {
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: true,
        clientId: 'enc:db-app-id',
        clientSecret: 'enc:db-app-secret',
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider } },
      });

      const link = await facebookAuthModule.create(ctx).generateLink();

      expect(findByProvider).toHaveBeenCalledWith('FACEBOOK');
      expect(link).toContain('client_id=db-app-id');
      expect(link).not.toContain('fb-app-id');
    });

    it('falls back to env when the DB row is disabled', async () => {
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: false,
        clientId: 'enc:db-app-id',
        clientSecret: 'enc:db-app-secret',
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider } },
      });

      const link = await facebookAuthModule.create(ctx).generateLink();

      expect(link).toContain('client_id=fb-app-id');
    });
  });

  describe('getToken', () => {
    it('exchanges the code against the Graph token endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockResponse({ access_token: 'fb-token' }));
      const { ctx } = makeCtx({ fetch: fetchMock });

      const token = await facebookAuthModule.create(ctx).getToken('code-123');

      expect(token).toBe('fb-token');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain(
        'https://graph.facebook.com/v20.0/oauth/access_token'
      );
      expect(url).toContain('client_id=fb-app-id');
      expect(url).toContain('client_secret=fb-app-secret');
      expect(url).toContain('code=code-123');
      expect(url).toContain(
        `redirect_uri=${encodeURIComponent(
          'https://app.example.com/integrations/social/facebook'
        )}`
      );
    });
  });

  describe('getUser', () => {
    it('maps the Graph /me response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse({
          id: '123',
          name: 'Ann Example',
          email: 'ann@example.com',
          picture: { data: { url: 'https://pic.example.com/ann.jpg' } },
        })
      );
      const { ctx } = makeCtx({ fetch: fetchMock });

      const user = await facebookAuthModule.create(ctx).getUser('fb-token');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('https://graph.facebook.com/v20.0/me');
      expect(url).toContain('access_token=fb-token');
      expect(user).toEqual({
        email: 'ann@example.com',
        id: '123',
        picture: 'https://pic.example.com/ann.jpg',
        name: 'Ann Example',
      });
    });

    it('synthesizes a stable address when Facebook returns no email', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse({
          id: '123',
          name: 'Ann Example',
          picture: { data: { url: 'https://pic.example.com/ann.jpg' } },
        })
      );
      const { ctx } = makeCtx({ fetch: fetchMock });

      const user = await facebookAuthModule.create(ctx).getUser('fb-token');

      expect(user.email).toBe('fb_123@facebook.login.postmill.local');
      expect(user.id).toBe('123');
    });
  });
});
