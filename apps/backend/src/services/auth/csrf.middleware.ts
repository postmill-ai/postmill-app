import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import * as crypto from 'crypto';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Only enforce CSRF for unsafe methods
    if (!UNSAFE_METHODS.includes(req.method.toUpperCase())) {
      next();
      return;
    }

    // Determine auth source: only enforce when auth came from cookie
    const authFromCookie = !!req.cookies?.auth;
    const authFromHeader = !!req.headers?.auth;

    // Exempt: header/API-key auth, or no cookie auth. Body fields are NOT an auth
    // source — no CSRF-covered route authenticates via body (auth.middleware reads
    // only headers.auth || cookies.auth; the sole body-`jwt` consumer is a no-auth
    // route), and the frontend always attaches `x-csrf-token`.
    if (!authFromCookie || authFromHeader) {
      next();
      return;
    }

    // Validate CSRF token with a constant-time compare to avoid leaking
    // cookie/header equality through timing side channels.
    const csrfCookie = req.cookies?.[CSRF_COOKIE];
    const csrfHeader = req.headers?.[CSRF_HEADER] as string | undefined;

    if (
      typeof csrfCookie !== 'string' ||
      typeof csrfHeader !== 'string' ||
      csrfCookie.length !== csrfHeader.length ||
      !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader))
    ) {
      res.status(403).json({ error: 'Invalid or missing CSRF token' });
      return;
    }

    next();
  }
}

export function issueCsrfToken(res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const token = require('crypto').randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    // NOT_SECURED relaxes cookie flags ONLY in development (same re-guard as
    // auth.controller.ts) — a stray prod NOT_SECURED must not strip Secure/sameSite.
    ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
      ? {
          secure: true,
          sameSite: 'none',
        }
      : {}),
    httpOnly: false, // must be readable by JavaScript
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
  });
  return token;
}
