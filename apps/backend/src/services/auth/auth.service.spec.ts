import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as crypto from 'crypto';
import dayjs from 'dayjs';
import { Provider } from '@prisma/client';

vi.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({
    OrganizationService: class {},
  })
);
vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({
    NotificationService: class {},
  })
);
vi.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
}));
vi.mock('@gitroom/backend/services/auth/providers/providers.manager', () => ({
  ProvidersManager: class {},
}));

const newsletterRegister = vi.fn().mockResolvedValue(undefined);
vi.mock('@gitroom/nestjs-libraries/newsletter/newsletter.service', () => ({
  NewsletterService: {
    register: (...args: unknown[]) => newsletterRegister(...args),
  },
}));

const authCheckerMock = {
  signJWT: vi.fn((payload: { id: string }) => `jwt:${payload.id}`),
  verifyJWT: vi.fn(),
  comparePassword: vi.fn(),
};
vi.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    signJWT: (payload: { id: string }) => authCheckerMock.signJWT(payload),
    verifyJWT: (token: string) => authCheckerMock.verifyJWT(token),
    comparePassword: (password: string, hash: string) =>
      authCheckerMock.comparePassword(password, hash),
  },
}));

import { AuthService } from './auth.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

type PrivateAuthService = {
  handleProviderPicture(
    userId: string,
    email: string,
    pictureUrl?: string | null
  ): Promise<void>;
};

function makeRegisterBody(overrides: Partial<CreateOrgUserDto> = {}) {
  return Object.assign(new CreateOrgUserDto(), {
    email: 'new@example.com',
    password: 'password123',
    provider: Provider.LOCAL,
    company: 'Acme',
    name: 'New',
    ...overrides,
  });
}

function makeLoginBody(overrides: Partial<LoginUserDto> = {}) {
  return Object.assign(new LoginUserDto(), {
    email: 'user@example.com',
    password: 'password123',
    provider: Provider.LOCAL,
    ...overrides,
  });
}

const ENV_KEYS = [
  'DISABLE_REGISTRATION',
  'DISALLOW_PLUS',
  'DATAFAST_API_KEY',
  'FRONTEND_URL',
] as const;
const originalEnv = ENV_KEYS.map((k) => [k, process.env[k]] as const);

describe('AuthService (backend)', () => {
  let usersService: Record<string, ReturnType<typeof vi.fn>>;
  let organizationService: Record<string, ReturnType<typeof vi.fn>>;
  let notificationService: Record<string, ReturnType<typeof vi.fn>>;
  let providerInstance: Record<string, ReturnType<typeof vi.fn>>;
  let providerManager: Record<string, ReturnType<typeof vi.fn>>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    process.env.FRONTEND_URL = 'https://app.example.com';

    usersService = {
      createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      getUserByEmail: vi.fn(),
      getUserByProvider: vi.fn(),
      getUserById: vi.fn(),
      updatePassword: vi.fn().mockResolvedValue({ id: 'user-1' }),
      activateUser: vi.fn().mockResolvedValue(undefined),
      updateUserAvatar: vi.fn().mockResolvedValue(undefined),
      findSessionByTokenHash: vi.fn(),
      findSessionByPreviousTokenHash: vi.fn().mockResolvedValue(null),
      revokeSession: vi.fn().mockResolvedValue(undefined),
      rotateSessionToken: vi.fn().mockResolvedValue(undefined),
      getUserSessions: vi.fn(),
      getSessionById: vi.fn(),
      revokeAllSessionsExcept: vi.fn().mockResolvedValue({ count: 2 }),
      revokeAllUserSessions: vi.fn().mockResolvedValue({ count: 3 }),
    };
    organizationService = {
      getCount: vi.fn().mockResolvedValue(1),
      createOrgAndUser: vi.fn(),
      addUserToOrg: vi.fn(),
    };
    notificationService = { sendEmail: vi.fn().mockResolvedValue(undefined) };
    providerInstance = {
      getUser: vi.fn(),
      getToken: vi.fn(),
      generateLink: vi.fn(),
      postRegistration: vi.fn().mockResolvedValue(undefined),
    };
    providerManager = {
      getProvider: vi.fn().mockReturnValue(providerInstance),
    };

    service = new AuthService(
      usersService as never,
      organizationService as never,
      notificationService as never,
      providerManager as never
    );
  });

  afterAll(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ── Sessions ──

  describe('createSession', () => {
    it('stores only the sha256 hash and returns the raw token', async () => {
      const raw = await service.createSession('user-1', '1.2.3.4', 'UA');

      expect(raw).toMatch(/^[0-9a-f]{128}$/); // 64 random bytes, hex
      expect(usersService.createSession).toHaveBeenCalledTimes(1);

      const stored = usersService.createSession.mock.calls[0][0];
      expect(stored.userId).toBe('user-1');
      expect(stored.ip).toBe('1.2.3.4');
      expect(stored.userAgent).toBe('UA');
      expect(stored.tokenHash).toBe(sha256(raw));
      expect(stored.tokenHash).not.toBe(raw);
      // ~30-day expiry
      expect(dayjs(stored.expiresAt).diff(dayjs(), 'day')).toBeGreaterThanOrEqual(29);
    });

    it('generates a unique token per session', async () => {
      const a = await service.createSession('user-1', 'ip', 'ua');
      const b = await service.createSession('user-1', 'ip', 'ua');
      expect(a).not.toBe(b);
    });
  });

  describe('refreshAccessToken', () => {
    const baseSession = {
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'current-hash',
      revokedAt: null as Date | null,
      expiresAt: dayjs().add(10, 'day').toDate(),
    };

    it('rotates the token: new hash stored, new jwt + raw token returned', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue({ ...baseSession });
      usersService.getUserById.mockResolvedValue({ id: 'user-1' });

      const oldToken = 'a'.repeat(128);
      const result = await service.refreshAccessToken(oldToken, '5.6.7.8', 'UA2');

      expect(usersService.findSessionByTokenHash).toHaveBeenCalledWith(
        sha256(oldToken)
      );
      expect(result.jwt).toBe('jwt:user-1');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{128}$/);
      expect(result.refreshToken).not.toBe(oldToken);

      const [userId, sessionId, newHash, prevHash, ip, ua] =
        usersService.rotateSessionToken.mock.calls[0];
      expect(userId).toBe('user-1');
      expect(sessionId).toBe('session-1');
      expect(newHash).toBe(sha256(result.refreshToken));
      expect(prevHash).toBe('current-hash');
      expect(ip).toBe('5.6.7.8');
      expect(ua).toBe('UA2');
    });

    it('rejects an unknown hash that matches no live or rotated session', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue(null);
      usersService.findSessionByPreviousTokenHash.mockResolvedValue(null);

      await expect(
        service.refreshAccessToken('stale-token', 'ip', 'ua')
      ).rejects.toThrow('Invalid refresh token');
      expect(usersService.rotateSessionToken).not.toHaveBeenCalled();
      expect(usersService.revokeSession).not.toHaveBeenCalled();
    });

    it('detects reuse of a rotated-out token: revokes the live session', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue(null);
      usersService.findSessionByPreviousTokenHash.mockResolvedValue({
        ...baseSession,
      });

      await expect(
        service.refreshAccessToken('reused-rotated-token', 'ip', 'ua')
      ).rejects.toThrow('Refresh token reuse detected — session revoked');
      expect(usersService.findSessionByPreviousTokenHash).toHaveBeenCalledWith(
        sha256('reused-rotated-token')
      );
      expect(usersService.revokeSession).toHaveBeenCalledWith(
        'user-1',
        'session-1'
      );
      expect(usersService.rotateSessionToken).not.toHaveBeenCalled();
    });

    it('does not re-revoke when the rotated-out token belongs to an already-revoked session', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue(null);
      usersService.findSessionByPreviousTokenHash.mockResolvedValue({
        ...baseSession,
        revokedAt: new Date(),
      });

      await expect(
        service.refreshAccessToken('reused-rotated-token', 'ip', 'ua')
      ).rejects.toThrow('Invalid refresh token');
      expect(usersService.revokeSession).not.toHaveBeenCalled();
    });

    it('rejects a revoked session without rotating', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue({
        ...baseSession,
        revokedAt: new Date(),
      });

      await expect(
        service.refreshAccessToken('reused-token', 'ip', 'ua')
      ).rejects.toThrow('Refresh token has been revoked');
      expect(usersService.rotateSessionToken).not.toHaveBeenCalled();
    });

    it('revokes and rejects an expired session', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue({
        ...baseSession,
        expiresAt: dayjs().subtract(1, 'minute').toDate(),
      });

      await expect(
        service.refreshAccessToken('expired-token', 'ip', 'ua')
      ).rejects.toThrow('Refresh token has expired');
      expect(usersService.revokeSession).toHaveBeenCalledWith(
        'user-1',
        'session-1'
      );
      expect(usersService.rotateSessionToken).not.toHaveBeenCalled();
    });

    it('rejects when the session user no longer exists', async () => {
      usersService.findSessionByTokenHash.mockResolvedValue({ ...baseSession });
      usersService.getUserById.mockResolvedValue(null);

      await expect(
        service.refreshAccessToken('orphan-token', 'ip', 'ua')
      ).rejects.toThrow('User not found');
    });
  });

  describe('getUserSessions / getSessionByTokenHash', () => {
    it('getUserSessions delegates to UsersService', async () => {
      const sessions = [{ id: 'session-1' }];
      usersService.getUserSessions.mockResolvedValue(sessions);
      expect(await service.getUserSessions('user-1')).toBe(sessions);
      expect(usersService.getUserSessions).toHaveBeenCalledWith('user-1');
    });

    it('getSessionByTokenHash delegates the hash lookup', async () => {
      const session = { id: 'session-1' };
      usersService.findSessionByTokenHash.mockResolvedValue(session);
      expect(await service.getSessionByTokenHash('hash')).toBe(session);
      expect(usersService.findSessionByTokenHash).toHaveBeenCalledWith('hash');
    });
  });

  describe('revokeSession', () => {
    it('rejects when the session does not exist', async () => {
      usersService.getSessionById.mockResolvedValue(null);
      await expect(
        service.revokeSession('user-1', 'session-x')
      ).rejects.toThrow('Session not found');
      expect(usersService.revokeSession).not.toHaveBeenCalled();
    });

    it("rejects another user's session", async () => {
      usersService.getSessionById.mockResolvedValue({
        id: 'session-1',
        userId: 'someone-else',
      });
      await expect(
        service.revokeSession('user-1', 'session-1')
      ).rejects.toThrow('Session not found');
      expect(usersService.revokeSession).not.toHaveBeenCalled();
    });

    it("revokes the user's own session", async () => {
      usersService.getSessionById.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
      });
      await service.revokeSession('user-1', 'session-1');
      expect(usersService.revokeSession).toHaveBeenCalledWith(
        'user-1',
        'session-1'
      );
    });
  });

  describe('revokeAllSessions', () => {
    it('keeps the current session when its hash is provided', async () => {
      await service.revokeAllSessions('user-1', 'current-hash');
      expect(usersService.revokeAllSessionsExcept).toHaveBeenCalledWith(
        'user-1',
        'current-hash'
      );
      expect(usersService.revokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('revokes everything when no current hash is provided', async () => {
      await service.revokeAllSessions('user-1');
      expect(usersService.revokeAllUserSessions).toHaveBeenCalledWith('user-1');
      expect(usersService.revokeAllSessionsExcept).not.toHaveBeenCalled();
    });
  });

  // ── Avatar handling ──

  describe('handleProviderPicture', () => {
    const callPrivate = (
      userId: string,
      email: string,
      pictureUrl?: string | null
    ) =>
      (service as unknown as PrivateAuthService).handleProviderPicture(
        userId,
        email,
        pictureUrl
      );

    it('prefers the provider picture when present', async () => {
      await callPrivate('user-1', 'user@example.com', 'https://pics.example.com/me.png');
      expect(usersService.updateUserAvatar).toHaveBeenCalledWith(
        'user-1',
        'https://pics.example.com/me.png'
      );
    });

    it('falls back to a Gravatar URL from the md5 of the normalized email', async () => {
      await callPrivate('user-1', '  User@Example.COM', null);

      const md5 = crypto
        .createHash('md5')
        .update('  user@example.com'.trim())
        .digest('hex');
      expect(usersService.updateUserAvatar).toHaveBeenCalledWith(
        'user-1',
        `https://www.gravatar.com/avatar/${md5}?d=404&s=200`
      );
    });

    it('sets no avatar when there is neither a picture nor an email', async () => {
      await callPrivate('user-1', '', null);
      expect(usersService.updateUserAvatar).not.toHaveBeenCalled();
    });
  });

  // ── Registration gating ──

  describe('canRegister', () => {
    it('allows registration when DISABLE_REGISTRATION is unset', async () => {
      expect(await service.canRegister(Provider.LOCAL)).toBe(true);
      expect(organizationService.getCount).not.toHaveBeenCalled();
    });

    it('always allows GENERIC (OIDC SSO) even when registration is disabled', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      expect(await service.canRegister(Provider.GENERIC)).toBe(true);
    });

    it('allows the very first registration of a fresh deployment', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      organizationService.getCount.mockResolvedValue(0);
      expect(await service.canRegister(Provider.LOCAL)).toBe(true);
    });

    it('blocks registration when disabled and orgs already exist', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      organizationService.getCount.mockResolvedValue(3);
      expect(await service.canRegister(Provider.LOCAL)).toBe(false);
    });
  });

  // ── routeAuth ──

  describe('routeAuth — LOCAL registration', () => {
    beforeEach(() => {
      organizationService.createOrgAndUser.mockResolvedValue({
        id: 'org-1',
        users: [{ user: { id: 'user-1', email: 'new@example.com' } }],
      });
    });

    it('creates org+user, sends the activation email, returns jwt + refresh token', async () => {
      usersService.getUserByEmail.mockResolvedValue(null);

      const result = await service.routeAuth(
        Provider.LOCAL,
        makeRegisterBody(),
        '1.2.3.4',
        'UA'
      );

      expect(organizationService.createOrgAndUser).toHaveBeenCalled();
      expect(notificationService.sendEmail).toHaveBeenCalledWith(
        'new@example.com',
        'Activate your account',
        expect.stringContaining('jwt:user-1')
      );
      expect(result.addedOrg).toBe(false);
      expect(result.jwt).toBe('jwt:user-1');
      expect(result.refreshToken).toMatch(/^[0-9a-f]{128}$/);
      expect(usersService.createSession).toHaveBeenCalled();
      const md5 = crypto
        .createHash('md5')
        .update('new@example.com')
        .digest('hex');
      expect(usersService.updateUserAvatar).toHaveBeenCalledWith(
        'user-1',
        `https://www.gravatar.com/avatar/${md5}?d=404&s=200`
      );
    });

    it('lowercases the email before lookup', async () => {
      usersService.getUserByEmail.mockResolvedValue(null);

      await service.routeAuth(
        Provider.LOCAL,
        makeRegisterBody({ email: 'New@Example.COM' }),
        'ip',
        'ua'
      );

      expect(usersService.getUserByEmail).toHaveBeenCalledWith('new@example.com');
    });

    it('rejects an already registered email', async () => {
      usersService.getUserByEmail.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.routeAuth(Provider.LOCAL, makeRegisterBody(), 'ip', 'ua')
      ).rejects.toThrow('Email already exists');
    });

    it('rejects when registration is disabled', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      organizationService.getCount.mockResolvedValue(2);
      usersService.getUserByEmail.mockResolvedValue(null);

      await expect(
        service.routeAuth(Provider.LOCAL, makeRegisterBody(), 'ip', 'ua')
      ).rejects.toThrow('Registration is disabled');
    });

    it('rejects plus-addressed emails when DISALLOW_PLUS is set', async () => {
      process.env.DISALLOW_PLUS = 'true';

      await expect(
        service.routeAuth(
          Provider.LOCAL,
          makeRegisterBody({ email: 'a+b@example.com' }),
          'ip',
          'ua'
        )
      ).rejects.toThrow('Email with plus sign is not allowed');
    });

    it('adds the new user to an org when an addToOrg payload is given', async () => {
      usersService.getUserByEmail.mockResolvedValue(null);
      organizationService.addUserToOrg.mockResolvedValue({ id: 'uo-1' });

      const result = await service.routeAuth(
        Provider.LOCAL,
        makeRegisterBody(),
        'ip',
        'ua',
        { orgId: 'org-9', role: 'USER', id: 'invite-1', roleId: 'role-member' }
      );

      expect(organizationService.addUserToOrg).toHaveBeenCalledWith(
        'user-1',
        'invite-1',
        'org-9',
        'USER',
        'role-member'
      );
      expect(result.addedOrg).toEqual({ id: 'uo-1' });
      expect(usersService.updateUserAvatar).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('https://www.gravatar.com/avatar/')
      );
    });
  });

  describe('routeAuth — LOCAL login', () => {
    const existingUser = {
      id: 'user-1',
      email: 'user@example.com',
      password: 'hashed',
      activated: true,
    };

    it('rejects an unknown email', async () => {
      usersService.getUserByEmail.mockResolvedValue(null);

      await expect(
        service.routeAuth(Provider.LOCAL, makeLoginBody(), 'ip', 'ua')
      ).rejects.toThrow('Invalid user name or password');
    });

    it('rejects a wrong password', async () => {
      usersService.getUserByEmail.mockResolvedValue(existingUser);
      authCheckerMock.comparePassword.mockReturnValue(false);

      await expect(
        service.routeAuth(Provider.LOCAL, makeLoginBody(), 'ip', 'ua')
      ).rejects.toThrow('Invalid user name or password');
    });

    it('rejects a non-activated user', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        ...existingUser,
        activated: false,
      });
      authCheckerMock.comparePassword.mockReturnValue(true);

      await expect(
        service.routeAuth(Provider.LOCAL, makeLoginBody(), 'ip', 'ua')
      ).rejects.toThrow('User is not activated');
    });

    it('logs in: signs a jwt without the password and opens a session', async () => {
      usersService.getUserByEmail.mockResolvedValue({ ...existingUser });
      authCheckerMock.comparePassword.mockReturnValue(true);

      const result = await service.routeAuth(
        Provider.LOCAL,
        makeLoginBody(),
        'ip',
        'ua'
      );

      expect(result.jwt).toBe('jwt:user-1');
      expect(result.addedOrg).toBe(false);
      expect(result.refreshToken).toMatch(/^[0-9a-f]{128}$/);
      expect(authCheckerMock.signJWT).toHaveBeenCalledWith(
        expect.not.objectContaining({ password: expect.anything() })
      );
    });
  });

  describe('routeAuth — provider login/registration', () => {
    it('returns the existing user for a known provider id', async () => {
      providerInstance.getUser.mockResolvedValue({ id: 'gh-1' });
      usersService.getUserByProvider.mockResolvedValue({ id: 'user-1' });

      const result = await service.routeAuth(
        Provider.GITHUB,
        makeRegisterBody({ providerToken: 'token-1' }),
        'ip',
        'ua'
      );

      expect(providerManager.getProvider).toHaveBeenCalledWith(Provider.GITHUB);
      expect(usersService.getUserByProvider).toHaveBeenCalledWith(
        'gh-1',
        Provider.GITHUB
      );
      expect(organizationService.createOrgAndUser).not.toHaveBeenCalled();
      expect(result.jwt).toBe('jwt:user-1');
    });

    it('rejects an invalid provider token', async () => {
      providerInstance.getUser.mockResolvedValue(null);

      await expect(
        service.routeAuth(
          Provider.GITHUB,
          makeRegisterBody({ providerToken: 'bad' }),
          'ip',
          'ua'
        )
      ).rejects.toThrow('Invalid provider token');
    });

    it('rejects new provider users when registration is disabled', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      organizationService.getCount.mockResolvedValue(1);
      providerInstance.getUser.mockResolvedValue({ id: 'gh-1' });
      usersService.getUserByProvider.mockResolvedValue(null);

      await expect(
        service.routeAuth(
          Provider.GITHUB,
          makeRegisterBody({ providerToken: 'token-1' }),
          'ip',
          'ua'
        )
      ).rejects.toThrow('Registration is disabled');
    });

    it('registers a new provider user: org created, newsletter, postRegistration, provider picture', async () => {
      providerInstance.getUser.mockResolvedValue({
        id: 'gh-1',
        email: 'gh@example.com',
        name: 'GH User',
        picture: 'https://avatars.example.com/gh-1.png',
      });
      usersService.getUserByProvider.mockResolvedValue(null);
      organizationService.createOrgAndUser.mockResolvedValue({
        id: 'org-2',
        users: [{ user: { id: 'user-2', email: 'gh@example.com' } }],
      });

      const result = await service.routeAuth(
        Provider.GITHUB,
        makeRegisterBody({ providerToken: 'token-1' }),
        'ip',
        'ua'
      );

      expect(organizationService.createOrgAndUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'gh@example.com',
          provider: Provider.GITHUB,
          providerId: 'gh-1',
          password: '',
        }),
        'ip',
        'ua'
      );
      expect(newsletterRegister).toHaveBeenCalledWith('gh@example.com');
      expect(providerInstance.postRegistration).toHaveBeenCalledWith(
        'token-1',
        'org-2'
      );
      expect(usersService.updateUserAvatar).toHaveBeenCalledWith(
        'user-2',
        'https://avatars.example.com/gh-1.png'
      );
      expect(result.jwt).toBe('jwt:user-2');
    });

    it('survives a postRegistration failure (registration still succeeds)', async () => {
      providerInstance.getUser.mockResolvedValue({
        id: 'gh-1',
        email: 'gh@example.com',
      });
      usersService.getUserByProvider.mockResolvedValue(null);
      organizationService.createOrgAndUser.mockResolvedValue({
        id: 'org-2',
        users: [{ user: { id: 'user-2', email: 'gh@example.com' } }],
      });
      providerInstance.postRegistration.mockRejectedValue(new Error('boom'));

      const result = await service.routeAuth(
        Provider.GITHUB,
        makeRegisterBody({ providerToken: 'token-1' }),
        'ip',
        'ua'
      );

      expect(result.jwt).toBe('jwt:user-2');
      // No provider picture → Gravatar fallback from the user's email.
      const md5 = crypto
        .createHash('md5')
        .update('gh@example.com')
        .digest('hex');
      expect(usersService.updateUserAvatar).toHaveBeenCalledWith(
        'user-2',
        `https://www.gravatar.com/avatar/${md5}?d=404&s=200`
      );
    });
  });

  // ── Org cookie ──

  describe('getOrgFromCookie', () => {
    it('returns false when there is no cookie', () => {
      expect(service.getOrgFromCookie(undefined)).toBe(false);
    });

    it('returns false for an unverifiable cookie', () => {
      authCheckerMock.verifyJWT.mockImplementation(() => {
        throw new Error('bad signature');
      });
      expect(service.getOrgFromCookie('garbage')).toBe(false);
    });

    it('returns false for an expired timeLimit', () => {
      authCheckerMock.verifyJWT.mockReturnValue({
        timeLimit: dayjs().subtract(1, 'hour').toISOString(),
      });
      expect(service.getOrgFromCookie('cookie')).toBe(false);
    });

    it('returns the org payload while still valid', () => {
      const payload = {
        email: 'a@b.com',
        role: 'ADMIN',
        orgId: 'org-1',
        id: 'invite-1',
        timeLimit: dayjs().add(1, 'hour').toISOString(),
      };
      authCheckerMock.verifyJWT.mockReturnValue(payload);
      expect(service.getOrgFromCookie('cookie')).toEqual(payload);
    });
  });

  // ── Password reset / activation ──

  describe('forgot', () => {
    it('returns false for an unknown email', async () => {
      usersService.getUserByEmail.mockResolvedValue(null);
      expect(await service.forgot('x@example.com')).toBe(false);
      expect(notificationService.sendEmail).not.toHaveBeenCalled();
    });

    it('returns false for a provider-backed account', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        providerName: Provider.GITHUB,
      });
      expect(await service.forgot('x@example.com')).toBe(false);
    });

    it('emails a reset link for a LOCAL account', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'x@example.com',
        providerName: Provider.LOCAL,
      });

      await service.forgot('x@example.com');

      expect(authCheckerMock.signJWT).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' })
      );
      expect(notificationService.sendEmail).toHaveBeenCalledWith(
        'x@example.com',
        'Reset your password',
        expect.stringContaining('jwt:user-1')
      );
    });
  });

  describe('forgotReturn', () => {
    it('returns false for an expired reset token', () => {
      authCheckerMock.verifyJWT.mockReturnValue({
        id: 'user-1',
        expires: dayjs().subtract(1, 'minute').format('YYYY-MM-DD HH:mm:ss'),
      });

      expect(
        service.forgotReturn({
          token: 't',
          password: 'newpass123',
          repeatPassword: 'newpass123',
        })
      ).toBe(false);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('updates the password while the token is valid', () => {
      authCheckerMock.verifyJWT.mockReturnValue({
        id: 'user-1',
        expires: dayjs().add(10, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
      });

      service.forgotReturn({
          token: 't',
          password: 'newpass123',
          repeatPassword: 'newpass123',
        });

      expect(usersService.updatePassword).toHaveBeenCalledWith(
        'user-1',
        'newpass123'
      );
    });
  });

  describe('activate', () => {
    it('activates a pending user and returns a fresh jwt', async () => {
      authCheckerMock.verifyJWT.mockReturnValue({
        id: 'user-1',
        activated: false,
        email: 'x@example.com',
      });
      usersService.getUserByEmail.mockResolvedValue({ activated: false });

      const result = await service.activate('code', 'visitor-1');

      expect(usersService.activateUser).toHaveBeenCalledWith('user-1');
      expect(result).toBe('jwt:user-1');
    });

    it('returns false when the account was already activated meanwhile', async () => {
      authCheckerMock.verifyJWT.mockReturnValue({
        id: 'user-1',
        activated: false,
        email: 'x@example.com',
      });
      usersService.getUserByEmail.mockResolvedValue({ activated: true });

      expect(await service.activate('code', 'visitor-1')).toBe(false);
      expect(usersService.activateUser).not.toHaveBeenCalled();
    });

    it('returns false for an already-activated token', async () => {
      authCheckerMock.verifyJWT.mockReturnValue({
        id: 'user-1',
        activated: true,
        email: 'x@example.com',
      });

      expect(await service.activate('code', 'visitor-1')).toBe(false);
    });
  });

  describe('resendActivationEmail', () => {
    it('rejects an unknown user', async () => {
      usersService.getUserByEmail.mockResolvedValue(null);
      await expect(
        service.resendActivationEmail('x@example.com')
      ).rejects.toThrow('User not found');
    });

    it('rejects an already activated account', async () => {
      usersService.getUserByEmail.mockResolvedValue({ activated: true });
      await expect(
        service.resendActivationEmail('x@example.com')
      ).rejects.toThrow('Account is already activated');
    });

    it('re-sends the activation email', async () => {
      usersService.getUserByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'x@example.com',
        activated: false,
      });

      expect(await service.resendActivationEmail('x@example.com')).toBe(true);
      expect(notificationService.sendEmail).toHaveBeenCalledWith(
        'x@example.com',
        'Activate your account',
        expect.stringContaining('jwt:user-1')
      );
    });
  });

  // ── OAuth helpers ──

  describe('oauthLink / checkExists', () => {
    it('oauthLink delegates to the provider', () => {
      providerInstance.generateLink.mockReturnValue('https://gh.example.com/auth');
      expect(service.oauthLink('GITHUB', { state: 's' })).toBe(
        'https://gh.example.com/auth'
      );
      expect(providerInstance.generateLink).toHaveBeenCalledWith({ state: 's' });
    });

    it('checkExists rejects an invalid provider user', async () => {
      providerInstance.getToken.mockResolvedValue('token-1');
      providerInstance.getUser.mockResolvedValue(null);

      await expect(service.checkExists('GITHUB', 'code')).rejects.toThrow(
        'Invalid user'
      );
    });

    it('checkExists returns a jwt for an existing account', async () => {
      providerInstance.getToken.mockResolvedValue('token-1');
      providerInstance.getUser.mockResolvedValue({ id: 'gh-1' });
      usersService.getUserByProvider.mockResolvedValue({ id: 'user-1' });

      expect(await service.checkExists('GITHUB', 'code')).toEqual({
        jwt: 'jwt:user-1',
        userId: 'user-1',
      });
    });

    it('checkExists returns the provider token when no account exists yet', async () => {
      providerInstance.getToken.mockResolvedValue('token-1');
      providerInstance.getUser.mockResolvedValue({ id: 'gh-1' });
      usersService.getUserByProvider.mockResolvedValue(null);

      expect(await service.checkExists('GITHUB', 'code')).toEqual({
        token: 'token-1',
        userId: undefined,
      });
    });
  });
});
