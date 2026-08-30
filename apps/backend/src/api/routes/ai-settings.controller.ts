import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import {
  AiSettingsManager,
  normalizeProviderId,
  qualifyProviderId,
} from '@postmill-ai/nestjs-libraries/ai/ai-settings.manager';
import { SaveGovernanceDto } from '@postmill-ai/nestjs-libraries/dtos/ai-settings/governance.dto';
import { AIProviderAdapter } from '@postmill-ai/nestjs-libraries/ai/ai-provider.interface';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { ProviderHealthService } from '@postmill-ai/nestjs-libraries/ai/governance/provider-health.service';
import { RagService } from '@postmill-ai/nestjs-libraries/ai/governance/rag.service';
import { OrgMediaProviderSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { RequirePermission } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@postmill-ai/backend/services/auth/rbac/org-rbac.guard';
import { SuperAdminGuard } from '@postmill-ai/backend/services/auth/rbac/super-admin.guard';
import {
  SaveRagSettingsDto,
  SaveMediaProviderDto,
  TriggerRagBackfillDto,
  UpdateSecretSettingsDto,
  UpsertOrgProviderConfigDto,
} from '@postmill-ai/nestjs-libraries/dtos/providers/admin-ai-settings.dtos';

// PROVIDER_REMEDIATION 0.1a/0.1b + 3.2: this controller writes the platform-global
// AISystemSettings singleton and, via :orgId path params, ANY tenant's
// AIOrgProviderConfig. It was gated only by `@RequirePermission('ai-config',
// 'manage')`, which the RBAC seeder grants to every org owner — a cross-tenant
// privilege escalation. The class-level SuperAdminGuard is the structural backstop;
// each handler also calls `_assertSuperAdmin` (defense in depth).
@ApiTags('AI Settings')
@Controller('/admin/ai-settings')
@UseGuards(SuperAdminGuard, OrgRbacGuard)
export class AiSettingsController {
  constructor(
    private _aiSettingsService: AiSettingsService,
    private _aiSettingsManager: AiSettingsManager,
    private _resolution: ProviderResolutionService,
    private _providerHealth: ProviderHealthService,
    private _ragService: RagService,
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
  ) {}

  // PROVIDER_REMEDIATION 0.1a/0.1b: platform-global + cross-org AI config is
  // super-admin only. `isSuperAdmin` is DB-resolved by AuthMiddleware (not
  // token-trusted). Mirrors AdminProvidersController._assertSuperAdmin.
  private _assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Super admin access required');
    }
  }

  // Resolve a single AI adapter through the ProviderKernel; undefined for an
  // unknown/unregistered provider (mirrors the old registry.getAdapter).
  private _resolveAdapter(identifier: string, version?: string): AIProviderAdapter | undefined {
    try {
      return this._resolution.resolveAI(identifier, version ? { version } : {});
    } catch {
      return undefined;
    }
  }

  @Get('/governance')
  @RequirePermission('ai-config', 'manage')
  async getGovernance(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    const settings = await this._aiSettingsService.getSystemSettings();
    if (!settings) return {};

    const safeParse = (val: string | null | undefined) => {
      if (!val) return null;
      if (typeof val !== 'string') return val;
      const trimmed = val.trim();
      if (!trimmed) return null;
      try { return JSON.parse(trimmed); } catch { return null; }
    };

    return {
      guardrailSettings: safeParse(settings.guardrailSettings),
      budgetSettings: safeParse(settings.budgetSettings),
      observability: safeParse(settings.observability),
      mcpSettings: safeParse(settings.mcpSettings),
      ragSettings: safeParse(settings.ragSettings),
      fallbackProvider: normalizeProviderId(settings.fallbackProvider),
      fallbackImageProvider: normalizeProviderId(settings.fallbackImageProvider),
    };
  }

  @Put('/governance')
  @RequirePermission('ai-config', 'manage')
  async saveGovernance(
    @GetUserFromRequest() user: User,
    @Body() body: SaveGovernanceDto,
  ) {
    this._assertSuperAdmin(user);
    await this._aiSettingsService.upsertSystemSettings({
      guardrailSettings: body.guardrailSettings,
      budgetSettings: body.budgetSettings,
      observability: body.observability,
      mcpSettings: body.mcpSettings,
      ragSettings: body.ragSettings,
      fallbackProvider: qualifyProviderId(body.fallbackProvider),
      fallbackImageProvider: qualifyProviderId(body.fallbackImageProvider),
    });

    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'update-governance',
      detail: JSON.stringify({ updated: Object.keys(body).join(',') }),
    });

    await this._aiSettingsManager.refreshCache();

    return { success: true };
  }

  @Get('/audit')
  @RequirePermission('ai-config', 'manage')
  async getAudit(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    return this._aiSettingsService.getAuditLogs();
  }

  @Get('/health')
  @RequirePermission('ai-config', 'manage')
  async getHealth(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    return {
      providerHealth: this._providerHealth.getAllHealth(),
    };
  }

  @Get('/rag')
  @RequirePermission('ai-config', 'manage')
  async getRagSettings(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    const settings = await this._aiSettingsService.getSystemSettings();
    return settings?.ragSettings ? JSON.parse(settings.ragSettings) : {};
  }

  @Put('/rag')
  @RequirePermission('ai-config', 'manage')
  async saveRagSettings(
    @GetUserFromRequest() user: User,
    @Body() body: SaveRagSettingsDto,
  ) {
    this._assertSuperAdmin(user);
    const rag = body.ragSettings;
    if (rag.vectorStore && !['pgvector', 'qdrant'].includes(rag.vectorStore)) {
      throw new BadRequestException('vectorStore must be "pgvector" or "qdrant"');
    }

    await this._aiSettingsService.upsertSystemSettings({ ragSettings: rag });
    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'update-rag',
      detail: JSON.stringify(this._aiSettingsService.redactSensitive(rag)),
    });
    await this._aiSettingsManager.refreshCache();

    return { success: true };
  }

  @Put('/media-providers/:id')
  @RequirePermission('ai-config', 'manage')
  async saveMediaProvider(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: SaveMediaProviderDto,
  ) {
    this._assertSuperAdmin(user);
    const adapter = this._resolveAdapter(id);
    if (!adapter) throw new BadRequestException('Unknown provider');

    const existing: { enabled?: boolean; operations?: string[]; c2paAvailable?: boolean } = {};
    if (body.enabled !== undefined) existing.enabled = body.enabled;
    if (body.operations !== undefined) existing.operations = body.operations;
    if (body.c2paAvailable !== undefined) existing.c2paAvailable = body.c2paAvailable;

    const orgIds = await this._aiSettingsService.getAllOrgIds();

    for (const orgId of orgIds) {
      await this._orgMediaProviderSettings.upsert(orgId, id, {
        enabled: existing.enabled,
      });
    }

    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'update-media-provider',
      detail: JSON.stringify({ identifier: id, ...existing }),
    });
    await this._aiSettingsManager.refreshCache();

    return { identifier: id, ...existing };
  }

  @Post('/rag/backfill')
  @RequirePermission('ai-config', 'manage')
  async triggerRagBackfill(
    @GetUserFromRequest() user: User,
    @Body() body: TriggerRagBackfillDto,
  ) {
    this._assertSuperAdmin(user);
    const orgId = body.organizationId;
    if (!orgId) {
      throw new BadRequestException('organizationId is required for RAG backfill');
    }

    try {
      const result = await this._ragService.backfill(orgId);

      await this._aiSettingsService.createSpendLog({
        organizationId: orgId,
        provider: 'rag',
        model: 'backfill',
        scope: 'backfill',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      });

      return {
        status: 'completed',
        organizationId: orgId,
        ...result,
      };
    } catch (err) {
      return {
        status: 'failed',
        organizationId: orgId,
        error: (err as Error).message,
      };
    }
  }

  @Put('/secret-settings')
  @RequirePermission('ai-config', 'manage')
  async updateSecretSettings(
    @GetUserFromRequest() user: User,
    @Body() body: UpdateSecretSettingsDto,
  ) {
    this._assertSuperAdmin(user);
    const settings = await this._aiSettingsService.getDecryptedSystemSettings();
    const existing = settings?.secretSettings || {};
    const merged = { ...existing, ...body.secretSettings };

    await this._aiSettingsService.upsertSystemSettings({ secretSettings: merged });
    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'update-secret-settings',
      detail: JSON.stringify({ updated: Object.keys(body.secretSettings) }),
    });
    await this._aiSettingsManager.refreshCache();

    return { success: true };
  }

  @Get('/org-providers/:orgId')
  @RequirePermission('ai-config', 'manage')
  async listOrgProviderConfigs(
    @GetUserFromRequest() user: User,
    @Param('orgId') orgId: string,
  ) {
    this._assertSuperAdmin(user);
    const configs = await this._aiSettingsService.getOrgProviderConfigs(orgId);
    return configs.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      identifier: c.identifier,
      enabled: c.enabled,
      defaultModel: c.defaultModel,
      reasoningModel: c.reasoningModel,
      extraConfig: this._aiSettingsService.safeJson(c.extraConfig),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  @Put('/org-providers/:orgId/:identifier')
  @RequirePermission('ai-config', 'manage')
  async upsertOrgProviderConfig(
    @GetUserFromRequest() user: User,
    @Param('orgId') orgId: string,
    @Param('identifier') identifier: string,
    @Body() body: UpsertOrgProviderConfigDto,
  ) {
    this._assertSuperAdmin(user);
    const before = await this._aiSettingsService.getOrgProviderConfig(orgId, identifier);
    const result = await this._aiSettingsService.upsertOrgProviderConfig(
      orgId,
      identifier,
      body,
    );

    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'upsert-org-provider',
      detail: JSON.stringify({
        organizationId: orgId,
        identifier,
        before: before
          ? {
              enabled: before.enabled,
              defaultModel: before.defaultModel,
              hasCredentials: !!before.credentials,
            }
          : null,
        after: {
          enabled: result.enabled,
          defaultModel: result.defaultModel,
          hasCredentials: !!result.credentials,
        },
        credentialsUpdated: body.credentials !== undefined,
      }),
    });

    // Auto-create matching MediaProviderConfig for OpenAI/MiniMax (§11.4)
    if (
      body.credentials &&
      (identifier === 'openai' || identifier === 'minimax')
    ) {
      try {
        await this._orgMediaProviderSettings.upsert(orgId, identifier, {
          enabled: true,
          credentials: body.credentials,
        });
      } catch (err) {
        // non-fatal — media auto-config failing should not break AI provider save
      }
    }

    return { identifier: result.identifier, enabled: result.enabled, updatedAt: result.updatedAt };
  }

  @Delete('/org-providers/:orgId/:identifier')
  @RequirePermission('ai-config', 'manage')
  async deleteOrgProviderConfig(
    @GetUserFromRequest() user: User,
    @Param('orgId') orgId: string,
    @Param('identifier') identifier: string,
  ) {
    this._assertSuperAdmin(user);
    await this._aiSettingsService.deleteOrgProviderConfig(orgId, identifier);

    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'delete-org-provider',
      detail: JSON.stringify({ organizationId: orgId, identifier }),
    });

    return { success: true };
  }
}
