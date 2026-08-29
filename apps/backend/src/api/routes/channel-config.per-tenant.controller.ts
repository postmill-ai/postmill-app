import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Post,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { OrgProviderConfigService } from '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/org-provider-config.service';
import { OrgProviderConfigManager } from '@postmill-ai/nestjs-libraries/integrations/org-provider-config.manager';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import {
  CreateChannelConfigDto,
  UpdateChannelConfigDto,
} from './channel-config.per-tenant.dto';

@ApiTags('Channel Config')
@Controller('/channels/config')
export class ChannelConfigPerTenantController {
  constructor(
    private _orgProviderConfigService: OrgProviderConfigService,
    private _orgProviderConfigManager: OrgProviderConfigManager,
    private _integrationManager: IntegrationManager,
  ) {}

  // Static provider catalog — used by the "Add channel" picker. Declared before
  // the `/:id` routes so it isn't captured as an id.
  @Get('/providers')
  @RequirePermission('channels', 'manage')
  async listProviders() {
    return this._integrationManager.getSocialProviderCatalog();
  }

  // The org's named credential-config instances (the list rows).
  @Get('/')
  @RequirePermission('channels', 'manage')
  async listConfigs(@GetOrgFromRequest() org: Organization) {
    const [configs, catalog, decrypted] = await Promise.all([
      this._orgProviderConfigService.getConfigs(org.id),
      this._integrationManager.getSocialProviderCatalog(),
      this._orgProviderConfigService.getDecryptedConfigs(org.id),
    ]);
    const entryByIdentifier = new Map(catalog.map((e) => [e.identifier, e]));
    const decryptedById = new Map(decrypted.map((d) => [d.id, d]));
    return configs.map((c) => ({
      ...c,
      capabilities: entryByIdentifier.get(c.identifier)?.capabilities || null,
      displayValues: this.#displayValues(
        entryByIdentifier.get(c.identifier),
        decryptedById.get(c.id)
      ),
    }));
  }

  @Get('/:id')
  @RequirePermission('channels', 'manage')
  async getConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    const config = await this._orgProviderConfigService.getConfigById(org.id, id);
    if (!config) {
      throw new BadRequestException('Channel config not found');
    }
    const catalog = await this._integrationManager.getSocialProviderCatalog();
    const entry = catalog.find((e) => e.identifier === config.identifier);
    const decrypted = (await this._orgProviderConfigService.getDecryptedConfigs(org.id)).find(
      (d) => d.id === id
    );
    return {
      ...config,
      capabilities: entry?.capabilities || null,
      displayValues: this.#displayValues(entry, decrypted),
    };
  }

  // Non-secret credential values (App IDs, configuration IDs, …) are returned so
  // the edit form can prefill them — they are identifiers, not secrets (they
  // travel in plaintext OAuth URLs). Fields marked `secret` in the descriptor
  // (clientSecret, bot tokens) stay write-only. Without a descriptor the
  // generic pair applies: clientId shown, clientSecret withheld.
  #displayValues(
    entry:
      | Awaited<
          ReturnType<IntegrationManager['getSocialProviderCatalog']>
        >[number]
      | undefined,
    decrypted:
      | Awaited<ReturnType<OrgProviderConfigService['getDecryptedConfigs']>>[number]
      | undefined
  ): Record<string, string> {
    if (!decrypted) return {};
    let extras: Record<string, unknown> = {};
    try {
      extras = decrypted.additionalConfig
        ? JSON.parse(decrypted.additionalConfig)
        : {};
    } catch {
      // malformed blob — treat as no extras rather than failing the read
    }
    const fields = entry?.setup?.credentialFields ?? [
      { key: 'clientId' },
      { key: 'clientSecret', secret: true },
    ];
    const out: Record<string, string> = {};
    for (const field of fields) {
      if ((field as { secret?: boolean }).secret) continue;
      const value =
        field.key === 'clientId'
          ? decrypted.clientId
          : field.key === 'clientSecret'
            ? decrypted.clientSecret
            : extras[field.key];
      if (typeof value === 'string' && value) out[field.key] = value;
    }
    return out;
  }

  @Post('/')
  @RequirePermission('channels', 'manage')
  async createConfig(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreateChannelConfigDto
  ) {
    if (!this._integrationManager.getSocialIntegrationUnchecked(body.identifier)) {
      throw new BadRequestException('Unknown provider');
    }

    const result = await this._orgProviderConfigService.createConfig(
      org.id,
      {
        identifier: body.identifier,
        name: body.name,
        enabled: body.enabled ?? false,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        redirectUri: body.redirectUri,
        scopes: body.scopes,
        additionalConfig: body.additionalConfig,
        setupNotes: body.setupNotes,
        vpnSelection: body.vpnSelection,
        version: body.version,
      },
      user.id
    );

    this._orgProviderConfigManager.invalidateOrg(org.id);
    return result;
  }

  @Put('/:id')
  @RequirePermission('channels', 'manage')
  async saveConfig(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: UpdateChannelConfigDto
  ) {
    const result = await this._orgProviderConfigService.updateConfig(
      org.id,
      id,
      {
        name: body.name,
        enabled: body.enabled,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        redirectUri: body.redirectUri,
        scopes: body.scopes,
        additionalConfig: body.additionalConfig,
        setupNotes: body.setupNotes,
        vpnSelection: body.vpnSelection,
        version: body.version,
      },
      user.id
    );

    this._orgProviderConfigManager.invalidateOrg(org.id);
    return result;
  }

  @Delete('/:id')
  @RequirePermission('channels', 'manage')
  async deleteConfig(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    await this._orgProviderConfigService.deleteConfig(org.id, id, user.id);
    this._orgProviderConfigManager.invalidateOrg(org.id);
    return { success: true };
  }

  @Post('/:id/test')
  @RequirePermission('channels', 'manage')
  async testConfig(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._orgProviderConfigService.testConnection(org.id, id);
  }
}
