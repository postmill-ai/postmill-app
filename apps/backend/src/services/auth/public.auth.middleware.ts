import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { ApiKeysService } from '@gitroom/nestjs-libraries/database/prisma/api-keys/api-keys.service';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import * as crypto from 'crypto';

@Injectable()
export class PublicAuthMiddleware implements NestMiddleware {
  constructor(
    private _oauthService: OAuthService,
    private _apiKeysService: ApiKeysService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const auth = (req.headers.authorization ||
      req.headers.Authorization) as string;
    if (!auth) {
      res.status(HttpStatus.UNAUTHORIZED).json({ msg: 'No API Key found' });
      return;
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
}
