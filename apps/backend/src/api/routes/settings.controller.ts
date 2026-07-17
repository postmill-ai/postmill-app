import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { ShortlinkPreferenceDto } from '@gitroom/nestjs-libraries/dtos/settings/shortlink-preference.dto';
import { CreateTeamUserDto } from '@gitroom/nestjs-libraries/dtos/settings/create-team-user.dto';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Settings')
@Controller('/settings')
export class SettingsController {
  constructor(
    private _organizationService: OrganizationService
  ) {}

  @Get('/team')
  @RequirePermission('settings', 'read')
  @CheckPolicies([AuthorizationActions.Create, Sections.TEAM_MEMBERS])
  async getTeam(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getTeam(org.id);
  }

  @Post('/team')
  @RequirePermission('settings', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.TEAM_MEMBERS])
  async inviteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: AddTeamMemberDto
  ) {
    return this._organizationService.inviteTeamMember(org.id, user, body);
  }

  @Put('/team/:id/role')
  @RequirePermission('settings', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.TEAM_MEMBERS])
  changeTeamMemberRole(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body('role') role: 'USER' | 'ADMIN',
    @Body('roleId') roleId?: string,
  ) {
    return this._organizationService.changeTeamMemberRole(
      org,
      user,
      id,
      role === 'ADMIN' ? 'ADMIN' : 'USER',
      roleId,
    );
  }

  @Post('/team/create-user')
  @RequirePermission('settings', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.TEAM_MEMBERS])
  async createTeamUser(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateTeamUserDto
  ) {
    return this._organizationService.createTeamUser(
      org.id,
      user,
      body.email,
      body.password,
      body.role,
      body.roleId,
    );
  }

  @Delete('/team/:id')
  @RequirePermission('settings', 'update')
  @CheckPolicies([AuthorizationActions.Create, Sections.TEAM_MEMBERS])
  deleteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._organizationService.deleteTeamMember(org, id);
  }

  @Get('/shortlink')
  @RequirePermission('settings', 'read')
  async getShortlinkPreference(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getShortlinkPreference(org.id);
  }

  @Post('/shortlink')
  @RequirePermission('organization', 'update')
  async updateShortlinkPreference(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ShortlinkPreferenceDto
  ) {
    return this._organizationService.updateShortlinkPreference(
      org.id,
      body.shortlink
    );
  }
}
