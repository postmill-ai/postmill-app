import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

interface SuperAdminRequest {
  user?: { isSuperAdmin?: boolean };
}

/**
 * Structural backstop (PROVIDER_REMEDIATION 3.2 + AUTH-01) for every `/admin/*`
 * platform controller. Historically `permissions.service.ts` granted
 * `Sections.ADMIN` unconditionally, making `@CheckPolicies([Create, ADMIN])` a
 * no-op super-admin gate. AUTH-01 removed that grant; this guard remains the real
 * gate, resting on `User.isSuperAdmin` (DB-resolved by AuthMiddleware, not
 * token-trusted). Applied at class level so a future handler can't silently reopen
 * the gap by forgetting the per-handler `_assertSuperAdmin` line (which stays for
 * defense in depth).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SuperAdminRequest>();
    if (!request?.user?.isSuperAdmin) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
