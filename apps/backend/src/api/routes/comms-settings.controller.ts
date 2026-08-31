import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { CommsConfigService } from '@postmill-ai/nestjs-libraries/comms/comms-config.service';
import { CommsLinkService } from '@postmill-ai/nestjs-libraries/comms/comms-link.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  CreateCommsLinkDto,
  UpdateCommsLinkDto,
  UpsertCommsConfigDto,
} from '@postmill-ai/nestjs-libraries/dtos/comms/comms.dto';

@ApiTags('Comms Settings')
@Controller('/settings/comms')
export class CommsSettingsController {
  constructor(
    private _configService: CommsConfigService,
    private _linkService: CommsLinkService,
    private _organizationService: OrganizationService,
  ) {}

  @Get('/config')
  @RequirePermission('settings', 'read')
  async getConfig(@GetOrgFromRequest() org: Organization) {
    const [providers, links, team] = await Promise.all([
      this._configService.getProviders(org.id),
      this._linkService.listForOrg(org.id),
      // Member list for the link picker. Deliberately NOT /settings/team —
      // that route carries a TEAM_MEMBERS billing policy (402 on some tiers)
      // and comms linking must work on every tier.
      this._organizationService.getTeam(org.id),
    ]);
    return {
      providers,
      links,
      members: (team?.users ?? []).map(
        (member: {
          disabled: boolean;
          user: {
            id: string;
            email: string;
            activated: boolean;
            profile?: { name?: string | null; pictureId?: string | null } | null;
          };
          roleRef?: { key: string } | null;
        }) => ({
          id: member.user.id,
          email: member.user.email,
          name: member.user.profile?.name ?? undefined,
          pictureId: member.user.profile?.pictureId ?? undefined,
          roleKey: member.roleRef?.key,
          disabled: member.disabled || !member.user.activated,
        }),
      ),
    };
  }

  @Put('/config/:identifier')
  @RequirePermission('settings', 'update')
  async upsertConfig(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string,
    @Body() body: UpsertCommsConfigDto,
  ) {
    await this._configService.upsert(org.id, identifier, body, user.id);
    return { identifier, success: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/config/:identifier/test')
  @RequirePermission('settings', 'update')
  async testConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
  ) {
    return this._configService.test(org.id, identifier);
  }

  @Delete('/config/:identifier')
  @RequirePermission('settings', 'update')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string,
  ) {
    await this._configService.delete(org.id, identifier, user.id);
    return { success: true };
  }

  @Post('/links')
  @RequirePermission('settings', 'update')
  async createLink(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateCommsLinkDto,
  ) {
    // The connect code is returned ONLY here and from regenerate.
    return this._linkService.createLink(org.id, body.identifier, body.userId, {
      agentChatEnabled: body.agentChatEnabled,
      categories: { ...body.categories } as Record<string, boolean>,
    });
  }

  @Put('/links/:id')
  @RequirePermission('settings', 'update')
  async updateLink(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateCommsLinkDto,
  ) {
    return this._linkService.updateLink(org.id, id, {
      agentChatEnabled: body.agentChatEnabled,
      ...(body.categories
        ? { categories: { ...body.categories } as Record<string, boolean> }
        : {}),
    });
  }

  @Post('/links/:id/regenerate-code')
  @RequirePermission('settings', 'update')
  async regenerateCode(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._linkService.regenerateCode(org.id, id);
  }

  @Delete('/links/:id')
  @RequirePermission('settings', 'update')
  async deleteLink(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    return this._linkService.deleteLink(org.id, id);
  }
}
