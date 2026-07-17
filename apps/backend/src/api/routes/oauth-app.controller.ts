import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';

@ApiTags('OAuth App')
@Controller('/user/oauth-app')
export class OAuthAppController {
  constructor(private _oauthService: OAuthService) {}

  @Get('/')
  @RequirePermission('oauth_apps', 'manage')
  async getApp(@GetOrgFromRequest() org: Organization) {
    return this._oauthService.getApp(org.id);
  }

  @Post('/')
  @RequirePermission('oauth_apps', 'manage')
  async createApp(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateOAuthAppDto
  ) {
    return this._oauthService.createApp(org.id, body);
  }

  @Put('/')
  @RequirePermission('oauth_apps', 'manage')
  async updateApp(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateOAuthAppDto
  ) {
    return this._oauthService.updateApp(org.id, body);
  }

  @Delete('/')
  @RequirePermission('oauth_apps', 'manage')
  async deleteApp(@GetOrgFromRequest() org: Organization) {
    return this._oauthService.deleteApp(org.id);
  }

  @Post('/rotate-secret')
  @RequirePermission('oauth_apps', 'manage')
  async rotateSecret(@GetOrgFromRequest() org: Organization) {
    return this._oauthService.rotateSecret(org.id);
  }
}
