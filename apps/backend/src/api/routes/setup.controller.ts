import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Setup')
@Controller('/settings/setup')
export class SetupController {
  constructor(private _organizationService: OrganizationService) {}

  // Same RBAC gate as the other settings-mutation routes in this area
  // (/settings/ai/*, /settings/team/*): setup completion flips an org-level
  // flag, so it is an owner/admin action — a member must not be able to mark
  // setup done and silence the gate for the whole org. No @CheckPolicies:
  // that is the BILLING gate (402), no Sections entitlement maps to setup
  // completion, and first-run setup must also succeed on the FREE tier.
  @Post('/complete')
  @RequirePermission('settings', 'update')
  async completeSetup(
    @GetUserFromRequest() _user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    await this._organizationService.completeSetup(organization.id);
    return { setupCompleted: true };
  }
}
