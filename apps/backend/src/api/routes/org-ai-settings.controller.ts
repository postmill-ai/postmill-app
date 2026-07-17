import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { SetDefaultModelDto } from '@gitroom/nestjs-libraries/dtos/ai-settings/default-model.dto';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import {
  UpsertOrgAiConfigDto,
  UpdateBudgetDto,
  SetActiveVersionDto,
  ProviderTestConnectionDto,
} from '@gitroom/nestjs-libraries/dtos/providers/provider-config.dtos';

@ApiTags('Org AI Settings')
@Controller('/settings/ai')
export class OrgAiSettingsController {
  constructor(
    private _orgAiSettings: OrgAiSettingsService,
    private _defaultsService: AiDefaultsService,
  ) {}

  @Get('/providers')
  @RequirePermission('settings', 'read')
  async listProviders() {
    return this._defaultsService.listProviders();
  }

  @Get('/config')
  @RequirePermission('settings', 'read')
  async getConfig(@GetOrgFromRequest() org: Organization) {
    return this._defaultsService.getProviderConfigSummary(org.id);
  }

  @Put('/config/:identifier')
  @RequirePermission('settings', 'update')
  async upsertConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: UpsertOrgAiConfigDto,
  ) {
    await this._orgAiSettings.upsert(org.id, identifier, {
      // Configuring defaults to enabled; the kit's On/Off toggle PUTs an explicit
      // `{ enabled: false }` to disable without clearing credentials (mirrors the
      // media surface). Previously hardcoded `true`, which both ignored the toggle
      // and — once this body became a whitelisted DTO — 400'd on `{ enabled }`.
      enabled: body.enabled ?? true,
      credentials: body.credentials,
      defaultModel: body.defaultModel,
      reasoningModel: body.reasoningModel,
      version: body.version,
    });

    return { identifier, success: true };
  }

  @Post('/config/:identifier/set-active')
  @RequirePermission('settings', 'update')
  async setActive(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: SetActiveVersionDto = {},
  ) {
    try {
      const result = await this._orgAiSettings.setActive(org.id, identifier, body.version);
      return { identifier, isActive: result.isActive };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/config/:identifier/test')
  @RequirePermission('settings', 'update')
  async testConnection(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
    @Body() body: ProviderTestConnectionDto,
  ) {
    return this._orgAiSettings.testConnection(
      org.id,
      identifier,
      body.credentials,
    );
  }

  @Delete('/config/:identifier')
  @RequirePermission('settings', 'update')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('identifier') identifier: string,
  ) {
    await this._orgAiSettings.delete(org.id, identifier);
    return { success: true };
  }

  @Get('/budget')
  @RequirePermission('settings', 'read')
  async getBudget(@GetOrgFromRequest() org: Organization) {
    const budget = await this._orgAiSettings.getBudget(org.id);
    return budget || {};
  }

  @Put('/budget')
  @RequirePermission('settings', 'update')
  async updateBudget(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateBudgetDto,
  ) {
    await this._orgAiSettings.updateBudget(org.id, body);
    return { success: true };
  }

  // ── Model Defaults (per-org AI model defaults) ─────────────────────────────

  @Get('/defaults')
  @RequirePermission('settings', 'read')
  async getModelDefaults(@GetOrgFromRequest() org: Organization) {
    return this._defaultsService.getModelDefaults(org.id);
  }

  @Put('/defaults/:category')
  @RequirePermission('settings', 'update')
  async setModelDefault(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
    @Body() body: SetDefaultModelDto,
  ) {
    return this._defaultsService.setModelDefault(org.id, category, body);
  }

  @Delete('/defaults/:category')
  @RequirePermission('settings', 'update')
  async clearModelDefault(
    @GetOrgFromRequest() org: Organization,
    @Param('category') category: string,
  ) {
    return this._defaultsService.clearModelDefault(org.id, category);
  }

  @Get('/defaults/catalog')
  @RequirePermission('settings', 'read')
  async getModelDefaultsCatalog(
    @GetOrgFromRequest() org: Organization,
    @Query('category') category: string,
  ) {
    return this._defaultsService.getModelDefaultsCatalog(org.id, category);
  }
}
