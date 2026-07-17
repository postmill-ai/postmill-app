import {
  Controller,
  Delete,
  ForbiddenException,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { DeletionService } from '@gitroom/nestjs-libraries/database/prisma/users/deletion.service';

@ApiTags('Organizations')
@Controller('/organizations')
export class OrganizationsController {
  constructor(private _deletionService: DeletionService) {}

  /**
   * Delete an organization and all owned data (I1, GDPR erasure).
   *
   * Gated by `@RequirePermission('organization', 'delete')` — a permission only the
   * `owner` system role carries (admin is explicitly excluded in the RBAC seed), and
   * `User.isSuperAdmin` bypasses RBAC. Because the RBAC guard resolves permissions
   * against the member's *current* org, a non-super-admin may only delete the org
   * they are currently acting in — we assert `:id` matches it to stop an owner of
   * org A from deleting org B by id.
   */
  @Delete('/:id')
  @RequirePermission('organization', 'delete')
  async deleteOrganization(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    if (!user.isSuperAdmin && organization?.id !== id) {
      throw new ForbiddenException(
        'You can only delete the organization you are currently in'
      );
    }
    return this._deletionService.deleteOrganization(id, { userId: user.id });
  }
}
