import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ProviderConfigService } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service';
import { ProviderConfigManager } from '@gitroom/nestjs-libraries/integrations/provider-config.manager';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { Prisma } from '@prisma/client';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';
import { SaveChannelConfigDto } from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';

// PROVIDER_REMEDIATION 0.2 + 3.2: `ProviderConfiguration` is the platform-global
// social OAuth-app store (no organizationId). It was gated only by
// `@RequirePermission('channels','manage')`, which the RBAC seeder grants to owner,
// admin AND editor — so an editor could rewrite the global clientId/clientSecret and
// flip provider availability platform-wide. The class-level SuperAdminGuard is the
// structural backstop; each handler also calls `_assertSuperAdmin` (defense in depth).
@ApiTags('Channel Config')
@Controller('/admin/channel-configs')
// AUTH-03: guard ordering invariant — SuperAdminGuard runs FIRST and throws for any
// non-super-admin, so OrgRbacGuard never reaches its org-resolution / permission check
// for these platform-global endpoints. NestJS executes guards left-to-right.
@UseGuards(SuperAdminGuard, OrgRbacGuard)
export class ChannelConfigController {
  private readonly _logger = new Logger(ChannelConfigController.name);
  constructor(
    private _providerConfigService: ProviderConfigService,
    private _providerConfigManager: ProviderConfigManager,
    private _integrationManager: IntegrationManager
  ) {}

  private _assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Super admin access required');
    }
  }

  @Get('/')
  @RequirePermission('channels', 'manage')
  async listConfigs(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    const providers = this._integrationManager.getSocialProviders();
    return this._providerConfigService.getProviderCatalog(providers);
  }

  @Get('/:identifier')
  @RequirePermission('channels', 'manage')
  async getConfig(
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string
  ) {
    this._assertSuperAdmin(user);
    const providers = this._integrationManager.getSocialProviders();
    return this._providerConfigService.getProviderCatalogEntry(identifier, providers);
  }

  @Put('/:identifier')
  @RequirePermission('channels', 'manage')
  async saveConfig(
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string,
    @Body()
    body: SaveChannelConfigDto
  ) {
    this._assertSuperAdmin(user);
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    if (body.clientId !== undefined && typeof body.clientId !== 'string') {
      throw new BadRequestException('clientId must be a string');
    }
    if (body.clientSecret !== undefined && typeof body.clientSecret !== 'string') {
      throw new BadRequestException('clientSecret must be a string');
    }
    if (body.redirectUri !== undefined && typeof body.redirectUri !== 'string') {
      throw new BadRequestException('redirectUri must be a string');
    }
    if (body.scopes !== undefined && typeof body.scopes !== 'string') {
      throw new BadRequestException('scopes must be a string');
    }
    if (body.setupInstructions !== undefined && typeof body.setupInstructions !== 'string') {
      throw new BadRequestException('setupInstructions must be a string');
    }
    if (body.additionalConfig !== undefined && typeof body.additionalConfig !== 'string') {
      throw new BadRequestException('additionalConfig must be a string');
    }
    if (body.additionalConfig) {
      try {
        JSON.parse(body.additionalConfig);
      } catch {
        throw new BadRequestException('additionalConfig must be valid JSON');
      }
    }
    const provider =
      this._integrationManager.getSocialIntegrationUnchecked(identifier);
    if (!provider) {
      throw new BadRequestException('Unknown provider');
    }

    const result = await this._providerConfigService.upsert(identifier, {
      name: provider.name,
      enabled: body.enabled,
      clientId: body.clientId !== undefined ? body.clientId : undefined,
      clientSecret: body.clientSecret !== undefined ? body.clientSecret : undefined,
      redirectUri: body.redirectUri !== undefined ? body.redirectUri : undefined,
      scopes: body.scopes !== undefined ? body.scopes : undefined,
      additionalConfig: body.additionalConfig !== undefined ? body.additionalConfig : undefined,
      setupInstructions: body.setupInstructions !== undefined ? body.setupInstructions : undefined,
    });

    try {
      await this._providerConfigManager.refreshCache();
    } catch (err) {
      this._logger.warn(
        `Failed to refresh cache after config upsert, stale cache will self-correct: ${
          (err as Error)?.message ?? String(err)
        }`
      );
    }

    const decrypted = this._providerConfigService.decryptConfig(result);
    return {
      identifier: result.identifier,
      name: result.name,
      enabled: result.enabled,
      isConfigured: !!(decrypted.clientId || decrypted.clientSecret),
      redirectUri: result.redirectUri,
      scopes: result.scopes,
      additionalConfig: result.additionalConfig,
      setupInstructions: result.setupInstructions,
    };
  }

  @Delete('/:identifier')
  @RequirePermission('channels', 'manage')
  async deleteConfig(
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string
  ) {
    this._assertSuperAdmin(user);

    const config = await this._providerConfigService.getByIdentifier(
      identifier
    );
    if (!config) {
      return { success: true, message: 'Already deleted' };
    }

    try {
      await this._providerConfigService.delete(identifier);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        return { success: true, message: 'Already deleted' };
      }
      throw err;
    }

    try {
      await this._providerConfigManager.refreshCache();
    } catch (err) {
      this._logger.warn(
        `Failed to refresh cache after config delete, stale cache will self-correct: ${
          (err as Error)?.message ?? String(err)
        }`
      );
    }
    return { success: true };
  }
}
