import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { ShortLinkOAuthService } from '@gitroom/nestjs-libraries/short-linking/short-link-oauth.service';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { UpsertShortlinkConfigDto } from '@gitroom/nestjs-libraries/dtos/short-links/upsert-shortlink-config.dto';
import { TestShortlinkDto } from '@gitroom/nestjs-libraries/dtos/short-links/test-shortlink.dto';
import { OAuthUrlDto } from '@gitroom/nestjs-libraries/dtos/short-links/oauth-url.dto';
import { OAuthCallbackDto } from '@gitroom/nestjs-libraries/dtos/short-links/oauth-callback.dto';
import { SetActiveShortlinkDto } from '@gitroom/backend/dtos/short-links/set-active-shortlink.dto';

@ApiTags('Org ShortLink Settings')
@Controller('/settings/shortlinks')
@UseGuards(OrgRbacGuard)
export class OrgShortLinkSettingsController {
  constructor(
    private _orgShortLinkSettings: OrgShortLinkSettingsService,
    private _oauth: ShortLinkOAuthService,
  ) {}

  @Get('/providers')
  @RequirePermission('shortlink-config', 'manage')
  async listProviders() {
    return this._orgShortLinkSettings.listProviderMetadata();
  }

  @Get('/config')
  @RequirePermission('shortlink-config', 'manage')
  async getConfig(@GetOrgFromRequest() org: Organization) {
    const active = await this._orgShortLinkSettings.getActiveProvider(org.id);
    const allConfigs = await this._orgShortLinkSettings.getProviders(org.id);
    const safeActive = active
      ? (({ credentials, extraConfig, ...rest }) => rest)(active as any)
      : null;
    return {
      active: safeActive,
      providers: allConfigs,
    };
  }

  @Put('/config/:identifier')
  @RequirePermission('shortlink-config', 'manage')
  async upsertConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: UpsertShortlinkConfigDto,
  ) {
    return this._orgShortLinkSettings.upsertConfig(org.id, identifier, body);
  }

  @Put('/config/:identifier/:configId')
  @RequirePermission('shortlink-config', 'manage')
  async updateConfigById(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Param('configId') configId: string,
    @Body() body: UpsertShortlinkConfigDto,
  ) {
    return this._orgShortLinkSettings.updateConfigById(
      org.id,
      configId,
      identifier,
      body,
    );
  }

  @Post('/config/:identifier/set-active')
  @RequirePermission('shortlink-config', 'manage')
  async setActive(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: SetActiveShortlinkDto,
  ) {
    try {
      const result = await this._orgShortLinkSettings.setActive(org.id, identifier, body.version);
      return { identifier, isActive: result.isActive };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/config/:identifier/test')
  @RequirePermission('shortlink-config', 'manage')
  async testConnection(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: TestShortlinkDto,
  ) {
    try {
      return await this._orgShortLinkSettings.testConnection(
        org.id,
        identifier,
        body.credentials,
        body.customDomain,
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
  @RequirePermission('shortlink-config', 'manage')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
  ) {
    await this._orgShortLinkSettings.delete(org.id, identifier);
    return { success: true };
  }

  @Post('/config/:identifier/oauth/url')
  @RequirePermission('shortlink-config', 'manage')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async getOAuthUrl(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: OAuthUrlDto,
  ) {
    const version = await this._orgShortLinkSettings.getPinnedVersion(org.id, identifier);
    return this._oauth.getOAuthUrl(org.id, identifier, body.redirectUri, version);
  }

  @Post('/config/:identifier/oauth/callback')
  @RequirePermission('shortlink-config', 'manage')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async oauthCallback(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: OAuthCallbackDto,
  ) {
    const version = await this._orgShortLinkSettings.getPinnedVersion(org.id, identifier);
    return this._oauth.oauthCallback(
      org.id,
      identifier,
      body.code,
      body.state,
      body.redirectUri,
      version,
    );
  }
}
