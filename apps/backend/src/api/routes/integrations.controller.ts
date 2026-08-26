import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { isAllowedReturnUrl } from '@postmill-ai/nestjs-libraries/security/return-url.validator';
import { Organization, User } from '@prisma/client';
import { IntegrationFunctionDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/integration.function.dto';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { pricing } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';
import { mergeEffectiveLimits } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/effective.limits';
import { SubscriptionService } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { PostsService } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service';
import { CampaignsService } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { ConnectProviderDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/connect-provider.dto';
import { IntegrationTimeDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/integration.time.dto';
import { PlugDto } from '@postmill-ai/nestjs-libraries/dtos/plugs/plug.dto';

import { UpdateProviderSettingsDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/update-provider-settings.dto';
import { ChannelIdBodyDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/channel-id-body.dto';
import { PlugActivationDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/plug-activation.dto';
import { TelegramUpdatesQueryDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/telegram-updates-query.dto';
import { UpdateIntegrationGroupDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/update-integration-group.dto';
import { UpdateOnCustomerNameDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/update-on-customer-name.dto';
import { SetNicknameDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/set-nickname.dto';
import { ParseCuidPipe } from '@postmill-ai/nestjs-libraries/pipes/parse-cuid.pipe';
import { MoltbookRegisterDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/moltbook-register.dto';
import { MoltbookStatusQueryDto } from '@postmill-ai/nestjs-libraries/dtos/integrations/moltbook-status-query.dto';


import { TelegramProvider } from '@postmill-ai/provider-telegram';
import { MoltbookProvider } from '@postmill-ai/provider-moltbook';
import {
  AuthorizationActions,
  Sections,
} from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';

import { RefreshIntegrationService } from '@postmill-ai/nestjs-libraries/integrations/refresh.integration.service';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';

@ApiTags('Integrations')
@Controller('/integrations')
export class IntegrationsController {
  private readonly _logger = new Logger(IntegrationsController.name);

  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _postService: PostsService,
    private _campaignsService: CampaignsService,
    private _subscriptionService: SubscriptionService
  ) {}

  @Post('/provider/:id/connect')
  @RequirePermission('channels', 'create')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  // The frontend spreads the OAuth-callback query params (provider-specific —
  // `code`, `refresh`, `device_id`, …) into this body alongside the validated
  // page-selection fields. Strip (don't reject) those extras so the global
  // `forbidNonWhitelisted: true` pipe can't 400 a legitimate connect, while
  // still bounding/validating the fields `saveProviderPage` actually reads.
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }))
  async saveProviderPage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ConnectProviderDto
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Invalid body');
    }
    const result = await this._integrationService.saveProviderPage(
      org.id,
      id,
      body
    );
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Get('/:identifier/internal-plugs')
  async getInternalPlugs(@Param('identifier') identifier: string) {
    return this._integrationManager.getInternalPlugs(identifier);
  }

  @Get('/customers')
  getCustomers(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.customers(org.id);
  }

  @Put('/:id/group')
  @RequirePermission('channels', 'update')
  async updateIntegrationGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: UpdateIntegrationGroupDto
  ) {
    const result = await this._integrationService.updateIntegrationGroup(
      org.id,
      id,
      body.group
    );
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Put('/:id/customer-name')
  @RequirePermission('channels', 'update')
  async updateOnCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: UpdateOnCustomerNameDto
  ) {
    const result = await this._integrationService.updateOnCustomerName(
      org.id,
      id,
      body.name
    );
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Get('/list')
  async getIntegrationList(@GetOrgFromRequest() org: Organization) {
    return this._integrationManager.getIntegrationListResponse(org.id);
  }

  @Post('/:id/settings')
  @RequirePermission('channels', 'update')
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: UpdateProviderSettingsDto
  ) {
    await this._integrationService.updateProviderSettings(
      org.id,
      id,
      body.additionalSettings
    );
    await this._integrationManager.invalidateIntegrationListCache(org.id);
  }
  @Post('/:id/nickname')
  @RequirePermission('channels', 'update')
  async setNickname(
    @GetOrgFromRequest() org: Organization,
    @Param('id', ParseCuidPipe) id: string,
    @Body() body: SetNicknameDto
  ) {
    const integration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );
    if (!integration) {
      throw new Error('Invalid integration');
    }

    const manager = await this._integrationManager.getSocialIntegration(
      integration.providerIdentifier,
      org.id
    );
    if (!manager.changeProfilePicture && !manager.changeNickname) {
      throw new Error('Invalid integration');
    }

    const { url } = manager.changeProfilePicture
      ? await manager.changeProfilePicture(
          integration.internalId,
          integration.token,
          body.picture
        )
      : { url: '' };

    const { name } = manager.changeNickname
      ? await manager.changeNickname(
          integration.internalId,
          integration.token,
          body.name
        )
      : { name: '' };

    const result = await this._integrationService.updateNameAndUrl(
      org.id,
      id,
      name,
      url
    );
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @Query('externalUrl') externalUrl: string,
    @Query('redirectUrl') redirectUrl: string,
    @Query('onboarding') onboarding: string,
    @Query('config') config: string,
    @Query('campaign') campaign: string,
    @GetOrgFromRequest() org: Organization
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    const integrationProvider =
      await this._integrationManager.getSocialIntegration(integration, org.id);

    if (integrationProvider.externalUrl && !externalUrl) {
      throw new Error('Missing external url');
    }

    try {
      const clientInformation = await this._integrationManager.requireClientInformation(
        integration,
        org.id,
        config || undefined
      );

      // Campaign-scoped connect/invite: verify ownership before trusting the id.
      const validatedCampaign =
        campaign && (await this._campaignsService.get(campaign, org.id))
          ? campaign
          : undefined;

      if (redirectUrl && !isAllowedReturnUrl(redirectUrl)) {
        throw new Error('Invalid redirect URL');
      }

      return this._integrationManager.generateAuthUrl(integration, org.id, clientInformation, {
        externalUrl,
        configId: config || undefined,
        refresh,
        onboarding: onboarding === 'true',
        campaign: validatedCampaign,
        redirectUrl,
      });
    } catch (err) {
      // Was a silent `{ err: true }` — a provider misconfig (e.g. disabled org
      // channel config, X app without a whitelisted callback) was invisible in
      // logs and undebuggable in prod. Log the cause; the response shape stays.
      this._logger.warn(
        `generateAuthUrl failed for ${integration}: ${(err as Error)?.message || err}`
      );
      return { err: true };
    }
  }

  @Post('/:id/time')
  @RequirePermission('channels', 'update')
  async setTime(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    return this._integrationService.setTimes(org.id, id, body);
  }

  @Post('/mentions')
  @RequirePermission('channels', 'update')
  async mentions(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ) {
    return this._integrationService.getMentionsForQuery(
      org.id,
      body.id,
      body?.data?.query
    );
  }

  @Post('/function')
  @RequirePermission('channels', 'update')
  async functionIntegration(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ): Promise<any> {
    return this._integrationManager.callTool(
      org.id,
      body.id,
      body.name,
      body.data
    );
  }

  @Post('/disable')
  @RequirePermission('channels', 'update')
  async disableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ChannelIdBodyDto
  ) {
    const result = await this._integrationService.disableChannel(org.id, body.id);
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Post('/enable')
  @RequirePermission('channels', 'update')
  async enableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ChannelIdBodyDto
  ) {
    // Effective channel cap: plan + channel add-ons + limitOverrides. The
    // request-scoped org.subscription select is intentionally narrow (no
    // extra*/limitOverrides), so fetch the full row; with no subscription the
    // merge returns the STARTER plan's base channel limit.
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(org.id);
    const plan =
      pricing[subscription?.subscriptionTier || 'STARTER'] ?? pricing.STARTER;
    const channelLimit = mergeEffectiveLimits(plan, subscription).channel;
    const result = await this._integrationService.enableChannel(
      org.id,
      channelLimit,
      body.id
    );
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Delete('/')
  @RequirePermission('channels', 'delete')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ChannelIdBodyDto
  ) {
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      body.id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postService.deletePost(org.id, post.group).catch((err) => {});
      }
    }

    const result = await this._integrationService.deleteChannel(org.id, body.id);
    await this._integrationManager.invalidateIntegrationListCache(org.id);
    return result;
  }

  @Get('/plug/list')
  async getPlugList() {
    return { plugs: this._integrationManager.getAllPlugs() };
  }

  @Get('/:id/plugs')
  async getPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getPlugsByIntegrationId(org.id, id);
  }

  @Post('/:id/plugs')
  @RequirePermission('channels', 'create')
  async postPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: PlugDto
  ) {
    return this._integrationService.createOrUpdatePlug(org.id, id, body);
  }

  @Put('/plugs/:id/activate')
  @RequirePermission('channels', 'update')
  async changePlugActivation(
    @Param('id', ParseCuidPipe) id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: PlugActivationDto
  ) {
    return this._integrationService.changePlugActivation(org.id, id, body.status);
  }

  @Get('/telegram/updates')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getUpdates(@Query() query: TelegramUpdatesQueryDto) {
    try {
      return await new TelegramProvider().getBotId(query);
    } catch (err) {
      // Telegram bot not configured (no TELEGRAM_TOKEN) or a transient getUpdates error.
      // The frontend polls this while waiting for the user's /connect message, so a 500
      // here just spams errors — return empty so the connect flow degrades gracefully (#10).
      Logger.warn('telegram getUpdates failed; returning empty');
      return {};
    }
  }

  @Post('/moltbook/register')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async moltbookRegister(@Body() body: MoltbookRegisterDto) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.registerAgent(body.name, body.description);
      return {
        apiKey: result.api_key,
        claimUrl: result.claim_url,
        verificationCode: result.verification_code,
      };
    } catch (err: any) {
      return { error: err.message || 'Registration failed' };
    }
  }

  @Get('/moltbook/status')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async moltbookStatus(@Query() query: MoltbookStatusQueryDto) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.checkAgentStatus(query.apiKey);
      return { claimed: result?.status === 'claimed' };
    } catch (err) {
      return { claimed: false };
    }
  }
}
