import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('@gitroom/helpers/subdomain/subdomain.management', () => ({
  getCookieUrlFromDomain: () => 'localhost',
}));

import { CsrfMiddleware, issueCsrfToken } from './csrf.middleware';

type MockResponse = Response & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  cookie: ReturnType<typeof vi.fn>;
};

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
  } as unknown as MockResponse;
}

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    cookies: {},
    headers: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

describe('CsrfMiddleware', () => {
  let middleware: CsrfMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new CsrfMiddleware();
    next = vi.fn();
  });

  it('skips enforcement for safe methods', () => {
    const req = mockReq({ method: 'GET', cookies: { auth: 'jwt' } });
    const res = mockRes();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('skips when no auth cookie is present (header/API-key or anonymous clients)', () => {
    const req = mockReq({ cookies: {} });
    const res = mockRes();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('skips when auth also came from a header', () => {
    const req = mockReq({
      cookies: { auth: 'jwt' },
      headers: { auth: 'jwt' },
    });
    const res = mockRes();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes when cookie auth carries a matching x-csrf-token header', () => {
    const req = mockReq({
      cookies: { auth: 'jwt', csrf_token: 'token-a' },
      headers: { 'x-csrf-token': 'token-a' },
    });
    const res = mockRes();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the header token does not match the cookie', () => {
    const req = mockReq({
      cookies: { auth: 'jwt', csrf_token: 'token-a' },
      headers: { 'x-csrf-token': 'token-b' },
    });
    const res = mockRes();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or missing CSRF token' });
    expect(next).not.toHaveBeenCalled();
  });

  // M2: a body `jwt`/`params` field is NOT an auth source — cookie-authenticated
  // requests must always present the CSRF header regardless of body content.
  it('rejects with 403 even when the body carries jwt/params fields', () => {
    const req = mockReq({
      cookies: { auth: 'jwt', csrf_token: 'token-a' },
      headers: {},
      body: { jwt: 'extension-jwt', params: { foo: 'bar' } },
    });
    const res = mockRes();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('issueCsrfToken cookie flags (M1)', () => {
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

  it('keeps Secure/sameSite=none when NOT_SECURED is set but NODE_ENV is production', () => {
    process.env.NOT_SECURED = 'true';
    process.env.NODE_ENV = 'production';
    const res = mockRes();

    issueCsrfToken(res);

    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.objectContaining({ secure: true, sameSite: 'none', httpOnly: false })
    );
  });

  it('relaxes the flags only when NOT_SECURED and NODE_ENV=development', () => {
    process.env.NOT_SECURED = 'true';
    process.env.NODE_ENV = 'development';
    const res = mockRes();

    issueCsrfToken(res);

    const options = res.cookie.mock.calls[0][2] as Record<string, unknown>;
    expect(options.secure).toBeUndefined();
    expect(options.sameSite).toBeUndefined();
    expect(options.httpOnly).toBe(false);
  });

  it('sets Secure/sameSite=none when NOT_SECURED is unset', () => {
    delete process.env.NOT_SECURED;
    process.env.NODE_ENV = 'development';
    const res = mockRes();

    issueCsrfToken(res);

    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.objectContaining({ secure: true, sameSite: 'none' })
    );
  });
});
