import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkedinAuthModule } from './auth.adapter';

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
  process.env.LINKEDIN_CLIENT_ID = 'li-client-id';
  process.env.LINKEDIN_CLIENT_SECRET = 'li-client-secret';
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('linkedinAuthModule', () => {
  it('exposes the auth manifest shape', () => {
    expect(linkedinAuthModule.manifest).toMatchObject({
      domain: 'auth',
      providerId: 'linkedin',
      version: 'v1',
      status: 'active',
      authType: 'oauth2',
    });
  });

  describe('generateLink', () => {
    it('builds the LinkedIn OIDC authorization URL with state=login from env creds', async () => {
      const { ctx } = makeCtx();
      const link = await linkedinAuthModule.create(ctx).generateLink();

      expect(link).toBe(
        'https://www.linkedin.com/oauth/v2/authorization' +
          `?response_type=code` +
          `&client_id=li-client-id` +
          `&redirect_uri=${encodeURIComponent(
            'https://app.example.com/integrations/social/linkedin'
          )}` +
          `&state=login` +
          `&scope=openid%20profile%20email`
      );
    });

    it('throws when neither DB config nor env creds are present', async () => {
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
      const { ctx } = makeCtx();

      await expect(
        linkedinAuthModule.create(ctx).generateLink()
      ).rejects.toThrow('LinkedIn auth provider is not configured');
    });

    it('prefers an enabled DB config over env creds (decrypts secrets)', async () => {
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: true,
        clientId: 'enc:db-client-id',
        clientSecret: 'enc:db-client-secret',
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider } },
      });

      const link = await linkedinAuthModule.create(ctx).generateLink();

      expect(findByProvider).toHaveBeenCalledWith('LINKEDIN');
      expect(link).toContain('client_id=db-client-id');
      expect(link).not.toContain('li-client-id');
    });
  });

  describe('getToken', () => {
    it('posts a form-encoded exchange to the LinkedIn token endpoint', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockResponse({ access_token: 'li-token' }));
      const { ctx } = makeCtx({ fetch: fetchMock });

      const token = await linkedinAuthModule.create(ctx).getToken('code-123');

      expect(token).toBe('li-token');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      );
      expect(init.body).toContain('grant_type=authorization_code');
      expect(init.body).toContain('code=code-123');
      expect(init.body).toContain('client_id=li-client-id');
      expect(init.body).toContain('client_secret=li-client-secret');
      expect(init.body).toContain(
        `redirect_uri=${encodeURIComponent(
          'https://app.example.com/integrations/social/linkedin'
        )}`
      );
    });
  });

  describe('getUser', () => {
    it('maps the OIDC userinfo response (sub → id)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockResponse({
          sub: 'abc123',
          email: 'ann@example.com',
          name: 'Ann Example',
          picture: 'https://pic.example.com/ann.jpg',
        })
      );
      const { ctx } = makeCtx({ fetch: fetchMock });

      const user = await linkedinAuthModule.create(ctx).getUser('li-token');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.linkedin.com/v2/userinfo');
      expect(init.headers.Authorization).toBe('Bearer li-token');
      expect(user).toEqual({
        email: 'ann@example.com',
        id: 'abc123',
        picture: 'https://pic.example.com/ann.jpg',
        name: 'Ann Example',
      });
    });
  });
});
