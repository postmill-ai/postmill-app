import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesService } from '@gitroom/nestjs-libraries/database/prisma/roles/roles.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { REQUIRE_PERMISSION_KEY, RequirePermissionMetadata } from './require-permission.decorator';

const RBAC_PERMS_CACHE = Symbol('rbacPermsCache');

interface RbacRequest {
  user?: { id?: string; isSuperAdmin?: boolean };
  orgId?: string;
  org?: { id?: string };
  path?: string;
  [RBAC_PERMS_CACHE]?: Map<string, string[] | null>;
}

@Injectable()
export class OrgRbacGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rolesService: RolesService,
    private audit: AuditService,
  ) {}

  // F2(a): record an RBAC denial as a non-fatal audit event. Resource is the attempted
  // `(resource, action)`; never throws/blocks the (already-failing) request.
  private _recordDenied(
    orgId: string,
    userId: string,
    metadata: RequirePermissionMetadata,
  ) {
    try {
      Promise.resolve(
        this.audit.record({
          orgId,
          userId,
          action: 'rbac.denied',
          resource: `${metadata.resource}:${metadata.action}`,
          metadata: { resource: metadata.resource, action: metadata.action },
        }),
      ).catch(() => {});
    } catch {
      /* non-fatal: auditing must never break the (already-failing) request */
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RbacRequest>();

    // Explicit public bypass for the Inngest handler (signed requests, not org-authenticated).
    if (request.path && request.path.indexOf('/api/inngest') > -1) {
      return true;
    }

    const metadata = this.reflector.getAllAndOverride<RequirePermissionMetadata>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!metadata) {
      return true;
    }
    const userId = request?.user?.id;
    // AuthMiddleware sets `req.org` (the Organization), matching PoliciesGuard's
    // source; other auth paths may set `req.orgId` directly. Accept either.
    const orgId = request?.orgId ?? request?.org?.id;

    if (!userId) {
      throw new ForbiddenException('Not authenticated');
    }

    // AUTH-03: platform super-admins bypass org-scoped RBAC entirely. This must run
    // before the org-id check so that `/admin/*` routes guarded by
    // `@UseGuards(SuperAdminGuard, OrgRbacGuard)` can be reached without an org cookie.
    if (request?.user?.isSuperAdmin) {
      return true;
    }

    if (!orgId) {
      throw new ForbiddenException('Not authenticated');
    }

    const effectivePermissions = await this._resolvePermissions(request, userId, orgId);

    if (effectivePermissions === null) {
      throw new ForbiddenException('Not a member of this organization');
    }

    if (effectivePermissions.includes(`${metadata.resource}:manage`)) {
      return true;
    }

    if (effectivePermissions.includes(`${metadata.resource}:${metadata.action}`)) {
      return true;
    }

    this._recordDenied(orgId, userId, metadata);
    throw new ForbiddenException('Insufficient permissions');
  }

  private async _resolvePermissions(
    request: RbacRequest,
    userId: string,
    orgId: string,
  ): Promise<string[] | null> {
    const cacheKey = `${userId}_${orgId}`;
    const cache = (request[RBAC_PERMS_CACHE] ??= new Map<string, string[] | null>());
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const effective = await this.rolesService.getEffectivePermissions(orgId, userId);
    const perms = effective ? effective.permissions : null;
    cache.set(cacheKey, perms);
    return perms;
  }
}
