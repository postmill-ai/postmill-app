import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { OrgVpnConfigService } from '@gitroom/nestjs-libraries/vpn/org-vpn-config.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { UpsertVpnConfigDto } from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';

@ApiTags('Org VPN Settings')
@Controller('/settings/vpn')
export class OrgVpnSettingsController {
  constructor(private _orgVpnConfig: OrgVpnConfigService) {}

  @Get('/providers')
  @RequirePermission('settings', 'read')
  async listProviders() {
    return { providers: this._orgVpnConfig.getProviderMetadata() };
  }

  @Get('/config')
  @RequirePermission('settings', 'read')
  async getConfig(@GetOrgFromRequest() org: Organization) {
    return {
      providers: await this._orgVpnConfig.getProviders(org.id),
    };
  }

  @Put('/config/:identifier')
  @RequirePermission('settings', 'update')
  async upsertConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: UpsertVpnConfigDto,
  ) {
    await this._orgVpnConfig.upsert(org.id, identifier, body);
    return { identifier, success: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/config/:identifier/test')
  @RequirePermission('settings', 'update')
  async testConnection(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
  ) {
    try {
      return await this._orgVpnConfig.testConnection(org.id, identifier);
    } catch (err) {
      throw new HttpException(
        (err as Error).message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('/config/:identifier')
  @RequirePermission('settings', 'update')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
  ) {
    await this._orgVpnConfig.delete(org.id, identifier);
    return { success: true };
  }
}
