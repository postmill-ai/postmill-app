import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

export interface RequirePermissionMetadata {
  resource: string;
  action: string;
}

/**
 * @RequirePermission('posts', 'create')
 * Throws ForbiddenException (HTTP 403) if the org member lacks this permission.
 * Orthogonal to @CheckPolicies (which gates on billing/tier → HTTP 402).
 */
export const RequirePermission = (resource: string, action: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, { resource, action } as RequirePermissionMetadata);
