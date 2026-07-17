import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('@gitroom/helpers/subdomain/subdomain.management', () => ({
  getCookieUrlFromDomain: () => 'localhost',
}));

vi.mock('@gitroom/nestjs-libraries/auth/auth-context.resolver', () => ({
  AuthContextResolver: class {},
}));

vi.mock('@gitroom/nestjs-libraries/services/exception.filter', () => ({
  HttpForbiddenException: class HttpForbiddenException extends Error {
    constructor() {
      super('Forbidden');
    }
  },
}));

import { AuthMiddleware, removeAuth } from './auth.middleware';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';

type MockResponse = Response & {
  cookie: ReturnType<typeof vi.fn>;
  header: ReturnType<typeof vi.fn>;
};

function mockRes() {
  return {
    cookie: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  } as unknown as MockResponse;
}

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: {},
    cookies: {},
    ...overrides,
  } as unknown as Request;
}

describe('auth cookie flags (M1)', () => {
  const originalNotSecured = process.env.NOT_SECURED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNotSecured === undefined) {
      delete process.env.NOT_SECURED;
    } else {
      process.env.NOT_SECURED = originalNotSecured;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('removeAuth keeps Secure/httpOnly/sameSite when NOT_SECURED is set but NODE_ENV is production', () => {
    process.env.NOT_SECURED = 'true';
    process.env.NODE_ENV = 'production';
    const res = mockRes();

    removeAuth(res);

    expect(res.cookie).toHaveBeenCalledWith(
      'auth',
      '',
      expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'none' })
    );
    expect(res.header).toHaveBeenCalledWith('logout', 'true');
  });

  it('removeAuth relaxes the flags only when NOT_SECURED and NODE_ENV=development', () => {
    process.env.NOT_SECURED = 'true';
    process.env.NODE_ENV = 'development';
    const res = mockRes();

    removeAuth(res);

    const options = res.cookie.mock.calls[0][2] as Record<string, unknown>;
    expect(options.secure).toBeUndefined();
    expect(options.httpOnly).toBeUndefined();
    expect(options.sameSite).toBeUndefined();
  });

  it('removeAuth sets the flags when NOT_SECURED is unset', () => {
    delete process.env.NOT_SECURED;
    process.env.NODE_ENV = 'development';
    const res = mockRes();

    removeAuth(res);

    expect(res.cookie).toHaveBeenCalledWith(
      'auth',
      '',
      expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'none' })
    );
  });
});

describe('AuthMiddleware', () => {
  const originalNotSecured = process.env.NOT_SECURED;
  const originalNodeEnv = process.env.NODE_ENV;
  let resolver: { resolve: ReturnType<typeof vi.fn> };
  let middleware: AuthMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    resolver = { resolve: vi.fn() };
    middleware = new AuthMiddleware(resolver as any);
    next = vi.fn();
  });

  afterEach(() => {
    if (originalNotSecured === undefined) {
      delete process.env.NOT_SECURED;
    } else {
      process.env.NOT_SECURED = originalNotSecured;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws HttpForbiddenException and clears the auth cookie when no auth is present', async () => {
    process.env.NOT_SECURED = 'true';
    process.env.NODE_ENV = 'production';
    const req = mockReq();
    const res = mockRes();

    await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(
      HttpForbiddenException
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith(
      'auth',
      '',
      expect.objectContaining({ secure: true, sameSite: 'none' })
    );
    expect(res.header).toHaveBeenCalledWith('logout', 'true');
  });

  it('throws HttpForbiddenException when the resolver rejects the context', async () => {
    resolver.resolve.mockResolvedValue({ ok: false });
    const req = mockReq({ headers: { auth: 'bad-jwt' } });
    const res = mockRes();

    await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(
      HttpForbiddenException
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('does not re-issue a cookie when the token is far from expiry', async () => {
    resolver.resolve.mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'user-1' },
        org: { id: 'org-1' },
        impersonated: false,
        expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
    });
    const req = mockReq({ headers: { auth: 'jwt' } });
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  // M1: the sliding re-issue write must keep Secure/httpOnly/sameSite even when a
  // stray prod NOT_SECURED is present (dev-only relaxation).
  it('re-issues the auth cookie with Secure flags in production even when NOT_SECURED is set', async () => {
    process.env.NOT_SECURED = 'true';
    process.env.NODE_ENV = 'production';
    resolver.resolve.mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'user-1' },
        org: { id: 'org-1' },
        impersonated: false,
        expiresAt: Math.floor(Date.now() / 1000),
      },
    });
    const req = mockReq({ headers: { auth: 'jwt' } });
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'auth',
      expect.any(String),
      expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'none' })
    );
    // Sliding re-issue also rotates the CSRF token.
    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.objectContaining({ secure: true, sameSite: 'none' })
    );
  });

  it('skips re-issue entirely for impersonated contexts', async () => {
    resolver.resolve.mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'user-1' },
        org: { id: 'org-1' },
        impersonated: true,
        expiresAt: Math.floor(Date.now() / 1000),
      },
    });
    const req = mockReq({ headers: { auth: 'jwt' } });
    const res = mockRes();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
