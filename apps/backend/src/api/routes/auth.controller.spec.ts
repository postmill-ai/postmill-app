import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import { AuthController } from './auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

// ---------------------------------------------------------------------------
// F1 — Auth/OAuth behavioural tests.
//
// Covers the four behaviours the plan calls out:
//   1. register respects DISABLE_REGISTRATION (real AuthService.canRegister logic);
//   2. login success + failure (controller dispatch + cookie/headers);
//   3. JWT verification pins HS256 — an alg-none / HS512 token is rejected;
//   4. refresh-token rotation reuse -> the live session is revoked.
//
// Prisma/Redis/services are mocked; nothing touches the network or a DB.
// ---------------------------------------------------------------------------

function mockResponse() {
  const res: any = {};
  res.cookie = vi.fn().mockReturnValue(res);
  res.header = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  return res;
}

function makeController(overrides: {
  authService?: Partial<AuthService>;
  emailService?: any;
  authProviderManager?: any;
} = {}) {
  const authService = {
    getOrgFromCookie: vi.fn().mockReturnValue(false),
    routeAuth: vi.fn(),
    refreshAccessToken: vi.fn(),
    createSession: vi.fn(),
    ...overrides.authService,
  } as unknown as AuthService;

  const emailService = {
    hasProvider: vi.fn().mockReturnValue(false),
    ...overrides.emailService,
  };

  const authProviderManager = {
    getProviders: vi.fn().mockResolvedValue({ providers: [] }),
    ...overrides.authProviderManager,
  };

  const controller = new AuthController(
    authService,
    emailService as any,
    authProviderManager as any
  );

  return { controller, authService, emailService, authProviderManager };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('AuthController — F1 behavioural tests', () => {
  describe('register respects DISABLE_REGISTRATION', () => {
    // canRegister is the real unit implementing DISABLE_REGISTRATION; exercise it directly
    // with a mocked OrganizationService so the env-var contract is asserted on real code.
    function makeAuthService(orgCount: number) {
      const organizationService = {
        getCount: vi.fn().mockResolvedValue(orgCount),
      };
      const service = new AuthService(
        {} as any,
        organizationService as any,
        {} as any,
        {} as any
      );
      return { service, organizationService };
    }

    it('allows registration when DISABLE_REGISTRATION is unset', async () => {
      delete process.env.DISABLE_REGISTRATION;
      const { service } = makeAuthService(5);
      await expect(service.canRegister('LOCAL')).resolves.toBe(true);
    });

    it('blocks LOCAL registration when DISABLE_REGISTRATION=true and an org already exists', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      const { service, organizationService } = makeAuthService(1);
      await expect(service.canRegister('LOCAL')).resolves.toBe(false);
      expect(organizationService.getCount).toHaveBeenCalled();
    });

    it('still allows the very first org (bootstrap) when DISABLE_REGISTRATION=true', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      const { service } = makeAuthService(0);
      await expect(service.canRegister('LOCAL')).resolves.toBe(true);
    });

    it('always allows GENERIC (SSO) registration regardless of DISABLE_REGISTRATION', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      const { service } = makeAuthService(10);
      await expect(service.canRegister('GENERIC')).resolves.toBe(true);
    });

    it('controller register returns 400 (no auth cookie) when registration is disabled', async () => {
      const { controller, authService } = makeController({
        authService: {
          routeAuth: vi.fn().mockRejectedValue(new Error('Registration is disabled')),
        } as any,
      });
      const res = mockResponse();

      await controller.register(
        { cookies: {} } as any,
        { provider: 'LOCAL', email: 'a@b.com' } as any,
        res,
        '1.2.3.4',
        'agent'
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Registration failed');
      expect(res.cookie).not.toHaveBeenCalledWith('auth', expect.anything(), expect.anything());
    });
  });

  describe('login', () => {
    it('on success sets the auth cookie + reload header and returns login:true', async () => {
      const { controller, authService } = makeController({
        authService: {
          getOrgFromCookie: vi.fn().mockReturnValue(false),
          routeAuth: vi
            .fn()
            .mockResolvedValue({ jwt: 'jwt-token', refreshToken: 'refresh-token', addedOrg: false }),
        } as any,
      });
      const res = mockResponse();

      await controller.login(
        { cookies: {} } as any,
        { provider: 'LOCAL', email: 'a@b.com', password: 'pw' } as any,
        res,
        '1.2.3.4',
        'agent'
      );

      expect(authService.routeAuth).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('auth', 'jwt-token', expect.any(Object));
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', expect.any(Object));
      expect(res.header).toHaveBeenCalledWith('reload', 'true');
      expect(res.json).toHaveBeenCalledWith({ login: true });
    });

    it('on invalid credentials returns 400 and never sets an auth cookie', async () => {
      const { controller } = makeController({
        authService: {
          getOrgFromCookie: vi.fn().mockReturnValue(false),
          routeAuth: vi.fn().mockRejectedValue(new Error('Invalid user name or password')),
        } as any,
      });
      const res = mockResponse();

      await controller.login(
        { cookies: {} } as any,
        { provider: 'LOCAL', email: 'a@b.com', password: 'bad' } as any,
        res,
        '1.2.3.4',
        'agent'
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Invalid credentials');
      expect(res.cookie).not.toHaveBeenCalledWith('auth', expect.anything(), expect.anything());
    });
  });

  describe('GET /providers', () => {
    it('delegates provider-list composition to AuthProviderManager', async () => {
      const { controller, authProviderManager } = makeController({
        authProviderManager: {
          getProviders: vi.fn().mockResolvedValue({
            providers: [{ provider: 'LOCAL', displayName: 'Email', version: 'v1', status: 'active' }],
          }),
        },
      });

      const result = await controller.getProviders();

      expect(authProviderManager.getProviders).toHaveBeenCalled();
      expect(result).toEqual({
        providers: [{ provider: 'LOCAL', displayName: 'Email', version: 'v1', status: 'active' }],
      });
    });
  });

  describe('JWT verification pins HS256', () => {
    const secret = process.env.JWT_SECRET as string;

    it('accepts a valid HS256 token', () => {
      const token = jwt.sign({ id: 'u1' }, secret); // default HS256
      const decoded: any = AuthChecker.verifyJWT(token);
      expect(decoded.id).toBe('u1');
    });

    it('rejects an alg=none (unsigned) token', () => {
      const token = jwt.sign({ id: 'u1' }, '', { algorithm: 'none' as any });
      expect(() => AuthChecker.verifyJWT(token)).toThrow();
    });

    it('rejects a token signed with a non-HS256 algorithm (HS512)', () => {
      const token = jwt.sign({ id: 'u1' }, secret, { algorithm: 'HS512' });
      expect(() => AuthChecker.verifyJWT(token)).toThrow(/algorithm/i);
    });
  });

  describe('refresh-token rotation', () => {
    function makeAuthServiceWithUsers(users: any) {
      return new AuthService(users as any, {} as any, {} as any, {} as any);
    }

    it('rotates the session token and issues a fresh JWT on a valid refresh', async () => {
      const users = {
        findSessionByTokenHash: vi
          .fn()
          .mockResolvedValue({ id: 'sess-1', userId: 'u1', tokenHash: 'old-hash', revokedAt: null, expiresAt: new Date(Date.now() + 86400000) }),
        rotateSessionToken: vi.fn().mockResolvedValue(undefined),
        getUserById: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
      };
      const service = makeAuthServiceWithUsers(users);

      const result = await service.refreshAccessToken('the-refresh-token', '1.2.3.4', 'agent');

      expect(users.rotateSessionToken).toHaveBeenCalled();
      expect(result.jwt).toBeTruthy();
      // a brand-new opaque refresh token is minted (rotation), not the same one back
      expect(result.refreshToken).not.toBe('the-refresh-token');
    });

    it('on reuse of a rotated-out token, revokes the live session and throws', async () => {
      const users = {
        findSessionByTokenHash: vi.fn().mockResolvedValue(null),
        findSessionByPreviousTokenHash: vi
          .fn()
          .mockResolvedValue({ id: 'sess-reused', userId: 'u1', revokedAt: null }),
        revokeSession: vi.fn().mockResolvedValue(undefined),
      };
      const service = makeAuthServiceWithUsers(users);

      await expect(
        service.refreshAccessToken('a-rotated-out-token', '1.2.3.4', 'agent')
      ).rejects.toThrow(/reuse/i);
      expect(users.revokeSession).toHaveBeenCalledWith('u1', 'sess-reused');
    });

    it('controller.refresh returns 401 when the service rejects (e.g. reuse detected)', async () => {
      const { controller } = makeController({
        authService: {
          refreshAccessToken: vi
            .fn()
            .mockRejectedValue(new Error('Refresh token reuse detected — session revoked')),
        } as any,
      });
      const res = mockResponse();

      await controller.refresh(
        { cookies: { refresh_token: 'x' } } as any,
        {} as any,
        res,
        '1.2.3.4',
        'agent'
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired refresh token' });
    });
  });
});
