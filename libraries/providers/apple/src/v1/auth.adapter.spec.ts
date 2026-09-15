import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { appleAuthModule } from './auth.adapter';

const ORIGINAL_ENV = { ...process.env };

// Real EC P-256 keypair so the ES256 client-secret JWT can be verified for
// real — no mocked crypto.
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
const privateKeyPem = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const publicKeyPem = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
const privateKeyB64 = Buffer.from(privateKeyPem, 'utf8').toString('base64');

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
  process.env.APPLE_CLIENT_ID = 'ai.postmill.app.auth';
  process.env.APPLE_TEAM_ID = 'TEAMID1234';
  process.env.APPLE_KEY_ID = 'KEYID5678';
  process.env.APPLE_PRIVATE_KEY = privateKeyB64;
}

function signIdToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, privateKeyPem, { algorithm: 'ES256' });
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('appleAuthModule', () => {
  it('exposes the auth manifest shape', () => {
    expect(appleAuthModule.manifest).toMatchObject({
      domain: 'auth',
      providerId: 'apple',
      version: 'v1',
      status: 'active',
      authType: 'oauth2',
    });
  });

  describe('generateLink', () => {
    it('builds the Apple authorize URL with form_post + email scope from env creds', async () => {
      const { ctx } = makeCtx();
      const link = await appleAuthModule.create(ctx).generateLink();

      expect(link).toBe(
        'https://appleid.apple.com/auth/authorize' +
          `?client_id=ai.postmill.app.auth` +
          `&redirect_uri=${encodeURIComponent(
            'https://app.example.com/auth/callback/apple'
          )}` +
          `&response_type=code` +
          `&response_mode=form_post` +
          `&scope=email` +
          `&state=login`
      );
    });

    it('throws when neither DB config nor env creds are present', async () => {
      delete process.env.APPLE_CLIENT_ID;
      delete process.env.APPLE_TEAM_ID;
      delete process.env.APPLE_KEY_ID;
      delete process.env.APPLE_PRIVATE_KEY;
      const { ctx } = makeCtx();

      await expect(
        appleAuthModule.create(ctx).generateLink()
      ).rejects.toThrow('Apple auth provider is not configured');
    });

    it('prefers an enabled DB config over env creds (decrypts secrets)', async () => {
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: true,
        clientId: 'enc:db.services.id',
        clientSecret: `enc:${privateKeyB64}`,
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider } },
      });

      const link = await appleAuthModule.create(ctx).generateLink();

      expect(findByProvider).toHaveBeenCalledWith('APPLE');
      expect(link).toContain('client_id=db.services.id');
      expect(link).not.toContain('ai.postmill.app.auth');
    });

    it('falls back to env when the DB row is disabled', async () => {
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: false,
        clientId: 'enc:db.services.id',
        clientSecret: `enc:${privateKeyB64}`,
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider } },
      });

      const link = await appleAuthModule.create(ctx).generateLink();

      expect(link).toContain('client_id=ai.postmill.app.auth');
    });

    it('throws when the DB row is used but Team ID / Key ID env are missing', async () => {
      delete process.env.APPLE_TEAM_ID;
      delete process.env.APPLE_KEY_ID;
      const findByProvider = vi.fn().mockResolvedValue({
        enabled: true,
        clientId: 'enc:db.services.id',
        clientSecret: `enc:${privateKeyB64}`,
      });
      const { ctx } = makeCtx({
        extras: { authProviderRepo: { findByProvider } },
      });

      await expect(
        appleAuthModule.create(ctx).generateLink()
      ).rejects.toThrow('Apple auth provider is not configured');
    });
  });

  describe('getToken', () => {
    it('exchanges the code with a freshly minted ES256 client-secret JWT', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockResponse({ id_token: 'apple-id-token' }));
      const { ctx } = makeCtx({ fetch: fetchMock });

      const before = Math.floor(Date.now() / 1000);
      const token = await appleAuthModule.create(ctx).getToken('code-123');

      expect(token).toBe('apple-id-token');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://appleid.apple.com/auth/token');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      );

      const body = new URLSearchParams(init.body);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('code-123');
      expect(body.get('client_id')).toBe('ai.postmill.app.auth');
      expect(body.get('redirect_uri')).toBe(
        'https://app.example.com/auth/callback/apple'
      );

      // The client secret must be a verifiable ES256 JWT with Apple's claims.
      const clientSecret = body.get('client_secret')!;
      const decoded: any = jwt.verify(clientSecret, publicKeyPem, {
        algorithms: ['ES256'],
      });
      const header = jwt.decode(clientSecret, { complete: true })!.header;
      expect(decoded.iss).toBe('TEAMID1234');
      expect(decoded.aud).toBe('https://appleid.apple.com');
      expect(decoded.sub).toBe('ai.postmill.app.auth');
      expect(header.kid).toBe('KEYID5678');
      expect(header.alg).toBe('ES256');
      // 180-day lifetime (Apple's documented maximum).
      expect(decoded.exp - decoded.iat).toBe(60 * 60 * 24 * 180);
      expect(decoded.iat).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getUser', () => {
    it('decodes the id_token payload with an email claim', async () => {
      const { ctx } = makeCtx();
      const idToken = signIdToken({
        sub: '000123.abc',
        email: 'user@example.com',
      });

      const user = await appleAuthModule.create(ctx).getUser(idToken);

      expect(user).toEqual({
        id: '000123.abc',
        email: 'user@example.com',
        name: '',
      });
    });

    it('leaves email undefined when Apple withholds it (hidden relay address)', async () => {
      const { ctx } = makeCtx();
      const idToken = signIdToken({ sub: '000123.abc' });

      const user = await appleAuthModule.create(ctx).getUser(idToken);

      expect(user).toEqual({ id: '000123.abc', email: undefined, name: '' });
    });

    it('returns false for a malformed id_token', async () => {
      const { ctx } = makeCtx();

      expect(await appleAuthModule.create(ctx).getUser('not-a-jwt')).toBe(
        false
      );
    });
  });
});
