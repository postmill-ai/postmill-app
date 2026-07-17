import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AuthContextResolver } from '@gitroom/nestjs-libraries/auth/auth-context.resolver';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { issueCsrfToken } from '@gitroom/backend/services/auth/csrf.middleware';

export const removeAuth = (res: Response) => {
  res.cookie('auth', '', {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    // NOT_SECURED relaxes cookie flags ONLY in development (same re-guard as
    // auth.controller.ts) — a stray prod NOT_SECURED must not strip Secure/sameSite.
    ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
      ? {
          secure: true,
          httpOnly: true,
          sameSite: 'none',
        }
      : {}),
    expires: new Date(0),
    maxAge: -1,
  });
  res.header('logout', 'true');
};

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private _authContextResolver: AuthContextResolver) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.auth || req.cookies.auth;
    if (!auth) {
      removeAuth(res);
      throw new HttpForbiddenException();
    }

    const result = await this._authContextResolver.resolve({
      jwt: auth as string,
      showOrgId: req.cookies.showorg || req.headers.showorg,
      impersonateOrgUserId: req.cookies.impersonate || req.headers.impersonate,
    });

    if (!result.ok) {
      removeAuth(res);
      throw new HttpForbiddenException();
    }

    const { user, org, impersonated } = result.context;

    // @ts-expect-error
    req.user = user;
    // @ts-expect-error
    req.org = org;

    if (impersonated) {
      // Super-admin impersonation stops here: do not re-issue a JWT for the
      // impersonated user (that would replace the admin's own session cookie).
      next();
      return;
    }

    // Sliding re-issue: if token is within 7 days of expiry, re-issue a new 30-day token.
    // Only the HTTP middleware re-issues; sockets do not.
    const expMs = result.context.expiresAt;
    if (expMs && expMs * 1000 - Date.now() < 7 * 24 * 60 * 60 * 1000) {
      const newJwt = AuthService.signJWT(user);
      res.cookie('auth', newJwt, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        // Dev-only NOT_SECURED relaxation, same as removeAuth above.
        ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development'
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      });
      issueCsrfToken(res);
    }

    next();
  }
}
