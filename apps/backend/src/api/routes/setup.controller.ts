import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';

@ApiTags('Setup')
@Controller('/settings/setup')
export class SetupController {
  constructor(private _organizationService: OrganizationService) {}

  @Post('/complete')
  async completeSetup(
    @GetUserFromRequest() _user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    await this._organizationService.completeSetup(organization.id);
    return { setupCompleted: true };
  }
}
