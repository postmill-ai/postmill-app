import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import {
  UpsertMediaConfigDto,
  SetMediaStorageDto,
  SetActiveVersionDto,
  ProviderTestConnectionDto,
} from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';

@ApiTags('Org Media Provider Settings')
@Controller('/settings/media')
export class MediaProviderController {
  constructor(
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
  ) {}

  @Get('/providers')
  @RequirePermission('media-config', 'manage')
  async listProviders() {
    return this._orgMediaProviderSettings.listProviderMetadata();
  }

  @Get('/config')
  @RequirePermission('media-config', 'manage')
  async getConfig(@GetOrgFromRequest() org: Organization) {
    const allConfigs = await this._orgMediaProviderSettings.getProviders(org.id);
    return { providers: allConfigs };
  }

  @Put('/config/:identifier')
  @RequirePermission('media-config', 'manage')
  async upsertConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: UpsertMediaConfigDto,
  ) {
    return this._orgMediaProviderSettings.upsertConfig(org.id, identifier, body);
  }

  @Put('/config/:identifier/storage')
  @RequirePermission('media-config', 'manage')
  async setStorage(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: SetMediaStorageDto,
  ) {
    return this._orgMediaProviderSettings.setStorage(org.id, identifier, body);
  }

  @Post('/config/:identifier/set-active')
  @RequirePermission('media-config', 'manage')
  async setActive(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: SetActiveVersionDto,
  ) {
    try {
      return await this._orgMediaProviderSettings.setActiveWithDefaults(
        org.id,
        identifier,
        body.version,
      );
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/config/:identifier/test')
  @RequirePermission('media-config', 'manage')
  async testConnection(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: ProviderTestConnectionDto,
  ) {
    try {
      return await this._orgMediaProviderSettings.testConnection(
        org.id,
        identifier,
        body.credentials,
      );
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException(
        (err as Error).message,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('/config/:identifier')
  @RequirePermission('media-config', 'manage')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
  ) {
    return this._orgMediaProviderSettings.deleteConfig(org.id, identifier);
  }
}
