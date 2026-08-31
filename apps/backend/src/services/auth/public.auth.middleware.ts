import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OAuthService } from '@postmill-ai/nestjs-libraries/database/prisma/oauth/oauth.service';
import { ApiKeysService } from '@postmill-ai/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { AuthContextResolver } from '@postmill-ai/nestjs-libraries/auth/auth-context.resolver';
import { HttpForbiddenException } from '@postmill-ai/nestjs-libraries/services/exception.filter';
import * as crypto from 'crypto';

// How the caller authenticated on the public API. Stamped on the request so
// downstream guards can apply the right policy posture:
// - 'api-key' / 'oauth' → integrators: throttled, no entitlement/RBAC gate
//   (documented public read parity).
// - 'cookie' → dashboard session: RBAC + entitlement enforced exactly as on
//   the app routes, mutations protected by CsrfMiddleware.
export type PublicAuthSource = 'api-key' | 'oauth' | 'cookie';

@Injectable()
export class PublicAuthMiddleware implements NestMiddleware {
  constructor(
    private _oauthService: OAuthService,
    private _apiKeysService: ApiKeysService,
    private _authContextResolver: AuthContextResolver
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const auth = (req.headers.authorization ||
      req.headers.Authorization) as string;

    // Dual auth: no Authorization header → fall back to the dashboard's
    // session cookie (the public API is the ONE API — the app consumes it too).
    if (!auth) {
      return this.useCookieSession(req, res, next);
    }
    try {
      if (auth.startsWith('pos_')) {
        const authorization = await this._oauthService.getOrgByOAuthToken(auth);
        if (!authorization) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'Invalid OAuth token' });
          return;
        }

        const org = authorization.organization;
        if (!!process.env.STRIPE_SECRET_KEY && !org.subscription) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'No subscription found' });
          return;
        }

        // 1.1: enforce the consented OAuth scopes instead of granting blanket
        // SUPERADMIN. Reject writes (any mutating HTTP verb) when the token was
        // not granted the write scope.
        const scopes = (authorization.scope || '')
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(
          (req.method || 'GET').toUpperCase()
        );
        if (isWrite && !scopes.includes('mcp:posts:write')) {
          res.status(HttpStatus.FORBIDDEN).json({
            msg: 'Insufficient OAuth scope: mcp:posts:write required',
          });
          return;
        }

        // Map the pos_ token to the granting user's ACTUAL org role (mirror the
        // API-key branch) — never hard-code SUPERADMIN.
        const oauthUserOrg = authorization.user?.organizations?.find(
          (o) => o.organizationId === authorization.organizationId
        );
        const oauthRoleKey = oauthUserOrg?.roleRef?.key ?? 'member';

        // @ts-ignore
        req.oauthScopes = scopes;
        // @ts-ignore
        req.authSource = 'oauth' satisfies PublicAuthSource;
        // @ts-ignore
        req.org = {
          ...org,
          users: [
            {
              roleId: oauthUserOrg?.roleId ?? undefined,
              roleRef: oauthUserOrg?.roleRef ?? undefined,
              users: { role: oauthRoleKey },
            },
          ],
        };
      } else {
        const hash = crypto.createHash('sha256').update(auth).digest('hex');
        const apiKey = await this._apiKeysService.findActiveByHash(hash);
        if (!apiKey) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'Invalid API key' });
          return;
        }

        if (!!process.env.STRIPE_SECRET_KEY && !apiKey.organization.subscription) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'No subscription found' });
          return;
        }

        const userOrg = apiKey.user.organizations?.find(
          (o) => o.organizationId === apiKey.organizationId,
        );
        const roleKey =
          userOrg?.roleRef?.key ??
          (apiKey.user.isSuperAdmin ? 'owner' : 'member');
        // @ts-ignore
        req.authSource = 'api-key' satisfies PublicAuthSource;
        // @ts-ignore
        req.org = {
          ...apiKey.organization,
          users: [{ roleId: userOrg?.roleId ?? undefined, users: { role: roleKey } }],
        };
        // @ts-ignore
        req.user = apiKey.user;

        this._apiKeysService.touchLastUsed(apiKey.id, apiKey.organizationId).catch(() => {});
      }
    } catch (err) {
      throw new HttpForbiddenException();
    }
    next();
  }

  // Dashboard session path: same JWT cookie the app API's AuthMiddleware
  // validates, resolved through the same AuthContextResolver (showorg /
  // impersonate honored). Sliding JWT re-issue stays with the app API — the
  // dashboard always calls app routes alongside, which refresh the session.
  private async useCookieSession(req: Request, res: Response, next: NextFunction) {
    const cookie = req.cookies?.auth;
    if (!cookie) {
      res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ msg: 'No credentials found' });
      return;
    }

    const result = await this._authContextResolver.resolve({
      jwt: cookie,
      showOrgId: req.cookies.showorg || req.headers.showorg,
      impersonateOrgUserId: req.cookies.impersonate || req.headers.impersonate,
    });

    if (!result.ok) {
      res.status(HttpStatus.UNAUTHORIZED).json({ msg: 'Invalid session' });
      return;
    }

    // @ts-ignore
    req.user = result.context.user;
    // @ts-ignore
    req.org = result.context.org;
    // @ts-ignore
    req.authSource = 'cookie' satisfies PublicAuthSource;
    next();
  }
}
