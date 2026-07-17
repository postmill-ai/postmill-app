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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { OrgContentPackSettingsService } from '@gitroom/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.service';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import {
  UpsertContentPackConfigDto,
  ProviderTestConnectionDto,
} from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';

@ApiTags('Org Content Pack Settings')
@Controller('/settings/content-packs')
@UseGuards(OrgRbacGuard)
export class ContentPackController {
  constructor(
    private _orgContentPackSettings: OrgContentPackSettingsService,
  ) {}

  @Get('/providers')
  @RequirePermission('media-config', 'manage')
  async listProviders() {
    return this._orgContentPackSettings.listProviderMetadata();
  }

  @Get('/config')
  @RequirePermission('media-config', 'manage')
  async getConfig(@GetOrgFromRequest() org: Organization) {
    const providers = await this._orgContentPackSettings.getProviders(org.id);
    const active = await this._orgContentPackSettings.getActiveProviderMetadata(org.id);
    return {
      active,
      providers,
    };
  }

  @Put('/config/:identifier')
  @RequirePermission('media-config', 'manage')
  async upsertConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: UpsertContentPackConfigDto
  ) {
    const meta = this._orgContentPackSettings.getProviderMetadata(identifier);
    if (!meta) {
      throw new BadRequestException('Unknown content pack provider');
    }

    await this._orgContentPackSettings.upsert(org.id, identifier, {
      credentials: body.credentials,
      extraConfig: body.extraConfig,
    });

    return { identifier, success: true };
  }

  @Post('/config/:identifier/set-active')
  @RequirePermission('media-config', 'manage')
  async setActive(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string
  ) {
    try {
      await this._orgContentPackSettings.setActive(org.id, identifier);
      return { identifier, isActive: true };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post('/deactivate')
  @RequirePermission('media-config', 'manage')
  async deactivate(@GetOrgFromRequest() org: Organization) {
    await this._orgContentPackSettings.setActive(org.id, null);
    return { isActive: false };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/config/:identifier/test')
  @RequirePermission('media-config', 'manage')
  async testConnection(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: ProviderTestConnectionDto
  ) {
    const meta = this._orgContentPackSettings.getProviderMetadata(identifier);
    if (!meta) {
      throw new BadRequestException('Unknown content pack provider');
    }

    try {
      return await this._orgContentPackSettings.testConnection(
        org.id,
        identifier,
        body.credentials?.apiKey ? body.credentials : undefined,
      );
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException((err as Error).message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('/config/:identifier')
  @RequirePermission('media-config', 'manage')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string
  ) {
    await this._orgContentPackSettings.delete(org.id, identifier);
    return { success: true };
  }
}
