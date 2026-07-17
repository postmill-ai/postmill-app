import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';

vi.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.service', () => ({
  ApiKeysService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/services/exception.filter', () => ({
  HttpForbiddenException: class HttpForbiddenException extends Error {
    constructor() {
      super('Forbidden');
    }
  },
}));

import { PublicAuthMiddleware } from './public.auth.middleware';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

type PublicRequest = Request & {
  org: { id?: string; users: { users: { role: string } }[] };
  user: unknown;
};

type MockResponse = Response & {
  status: Mock<(code: number) => MockResponse>;
  json: Mock<(body: unknown) => MockResponse>;
};

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as MockResponse;
}

function mockReq(authorization?: string, method = 'GET') {
  return {
    method,
    headers: authorization ? { authorization } : {},
  } as unknown as PublicRequest;
}

function makeApiKey(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    organizationId: 'org-1',
    organization: {
      id: 'org-1',
      name: 'Org One',
      subscription: { subscriptionTier: 'PRO', totalChannels: 10, isLifetime: false },
    },
    user: {
      id: 'user-1',
      email: 'user@example.com',
      isSuperAdmin: false,
      organizations: [
        {
          organizationId: 'org-1',
          userId: 'user-1',
          roleId: 'role-admin',
          roleRef: { id: 'role-admin', key: 'admin' },
        },
      ],
    },
    ...overrides,
  };
}

describe('PublicAuthMiddleware', () => {
  let oauthService: { getOrgByOAuthToken: ReturnType<typeof vi.fn> };
  let apiKeysService: {
    findActiveByHash: ReturnType<typeof vi.fn>;
    touchLastUsed: ReturnType<typeof vi.fn>;
  };
  let middleware: PublicAuthMiddleware;
  let next: Mock<(err?: unknown) => void>;
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    oauthService = { getOrgByOAuthToken: vi.fn() };
    apiKeysService = {
      findActiveByHash: vi.fn(),
      touchLastUsed: vi.fn().mockResolvedValue({ count: 1 }),
    };
    next = vi.fn<(err?: unknown) => void>();
    middleware = new PublicAuthMiddleware(
      oauthService as unknown as ConstructorParameters<typeof PublicAuthMiddleware>[0],
      apiKeysService as unknown as ConstructorParameters<typeof PublicAuthMiddleware>[1],
    );
  });

  afterEach(() => {
    if (originalStripeKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalStripeKey;
    }
  });

  it('returns 401 when no Authorization header is present', async () => {
    const req = mockReq();
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(res.json).toHaveBeenCalledWith({ msg: 'No API Key found' });
    expect(next).not.toHaveBeenCalled();
    expect(apiKeysService.findActiveByHash).not.toHaveBeenCalled();
  });

  it('returns 401 "Invalid API key" when findActiveByHash returns null (revoked/expired/unknown)', async () => {
    apiKeysService.findActiveByHash.mockResolvedValue(null);
    const req = mockReq('pm_live_revokedkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(apiKeysService.findActiveByHash).toHaveBeenCalledWith(
      sha256('pm_live_revokedkey'),
    );
    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(res.json).toHaveBeenCalledWith({ msg: 'Invalid API key' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.org with the user\'s actual UserOrganization role and req.user on a valid key', async () => {
    const apiKey = makeApiKey({
      user: {
        id: 'user-1',
        isSuperAdmin: true, // must NOT win over the real membership role
        organizations: [
          {
            organizationId: 'org-1',
            userId: 'user-1',
            roleId: 'role-admin',
            roleRef: { id: 'role-admin', key: 'admin' },
          },
        ],
      },
    });
    apiKeysService.findActiveByHash.mockResolvedValue(apiKey);
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.org.id).toBe('org-1');
    expect(req.org.users[0].users.role).toBe('admin');
    expect(req.org.users[0].users.role).not.toBe('owner');
    expect(req.user).toBe(apiKey.user);
    expect(apiKeysService.touchLastUsed).toHaveBeenCalledWith('key-1', 'org-1');
  });

  it('uses the membership of the key\'s org, not another org the user belongs to', async () => {
    const apiKey = makeApiKey({
      user: {
        id: 'user-1',
        isSuperAdmin: false,
        organizations: [
          { organizationId: 'other-org', userId: 'user-1', roleId: 'role-owner', roleRef: { id: 'role-owner', key: 'owner' } },
          { organizationId: 'org-1', userId: 'user-1', roleId: 'role-member', roleRef: { id: 'role-member', key: 'member' } },
        ],
      },
    });
    apiKeysService.findActiveByHash.mockResolvedValue(apiKey);
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(req.org.users[0].users.role).toBe('member');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to owner when the user has no UserOrganization but isSuperAdmin', async () => {
    const apiKey = makeApiKey({
      user: { id: 'user-1', isSuperAdmin: true, organizations: [] },
    });
    apiKeysService.findActiveByHash.mockResolvedValue(apiKey);
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(req.org.users[0].users.role).toBe('owner');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to member when the user has no UserOrganization and is not a super admin', async () => {
    const apiKey = makeApiKey({
      user: { id: 'user-1', isSuperAdmin: false, organizations: [] },
    });
    apiKeysService.findActiveByHash.mockResolvedValue(apiKey);
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(req.org.users[0].users.role).toBe('member');
    expect(next).toHaveBeenCalled();
  });

  it('routes a read (GET) pos_ token through OAuthService and maps to the granting user\'s real org role', async () => {
    oauthService.getOrgByOAuthToken.mockResolvedValue({
      organizationId: 'org-1',
      scope: 'mcp:read',
      organization: { id: 'org-1', subscription: { subscriptionTier: 'PRO' } },
      user: {
        id: 'user-1',
        organizations: [
          {
            organizationId: 'org-1',
            roleId: 'role-member',
            roleRef: { id: 'role-member', key: 'member' },
          },
        ],
      },
    });
    const req = mockReq('pos_oauthtoken', 'GET');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(oauthService.getOrgByOAuthToken).toHaveBeenCalledWith('pos_oauthtoken');
    expect(apiKeysService.findActiveByHash).not.toHaveBeenCalled();
    // No longer hard-coded SUPERADMIN — the real membership role is used.
    expect(req.org.users[0].users.role).toBe('member');
    expect((req as any).oauthScopes).toEqual(['mcp:read']);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a read-only pos_ token on a write route with 403', async () => {
    oauthService.getOrgByOAuthToken.mockResolvedValue({
      organizationId: 'org-1',
      scope: 'mcp:read',
      organization: { id: 'org-1', subscription: { subscriptionTier: 'PRO' } },
      user: {
        id: 'user-1',
        organizations: [
          { organizationId: 'org-1', roleId: 'role-admin', roleRef: { id: 'role-admin', key: 'admin' } },
        ],
      },
    });
    const req = mockReq('pos_readonly', 'POST');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(res.json).toHaveBeenCalledWith({
      msg: 'Insufficient OAuth scope: mcp:posts:write required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a pos_ token with mcp:posts:write on a write route and maps the real role', async () => {
    oauthService.getOrgByOAuthToken.mockResolvedValue({
      organizationId: 'org-1',
      scope: 'mcp:read mcp:posts:write',
      organization: { id: 'org-1', subscription: { subscriptionTier: 'PRO' } },
      user: {
        id: 'user-1',
        organizations: [
          { organizationId: 'org-1', roleId: 'role-admin', roleRef: { id: 'role-admin', key: 'admin' } },
        ],
      },
    });
    const req = mockReq('pos_writer', 'POST');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(req.org.users[0].users.role).toBe('admin');
    expect((req as any).oauthScopes).toEqual(['mcp:read', 'mcp:posts:write']);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 for an invalid pos_ token', async () => {
    oauthService.getOrgByOAuthToken.mockResolvedValue(null);
    const req = mockReq('pos_badtoken');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(res.json).toHaveBeenCalledWith({ msg: 'Invalid OAuth token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 "No subscription found" when STRIPE_SECRET_KEY is set and the org has no subscription', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    const apiKey = makeApiKey({
      organization: { id: 'org-1', subscription: null },
    });
    apiKeysService.findActiveByHash.mockResolvedValue(apiKey);
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(res.json).toHaveBeenCalledWith({ msg: 'No subscription found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an org without subscription when STRIPE_SECRET_KEY is not set', async () => {
    const apiKey = makeApiKey({
      organization: { id: 'org-1', subscription: null },
    });
    apiKeysService.findActiveByHash.mockResolvedValue(apiKey);
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('wraps unexpected lookup errors in HttpForbiddenException', async () => {
    apiKeysService.findActiveByHash.mockRejectedValue(new Error('db down'));
    const req = mockReq('pm_live_goodkey');
    const res = mockRes();

    await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(
      HttpForbiddenException,
    );
    expect(next).not.toHaveBeenCalled();
  });
});
