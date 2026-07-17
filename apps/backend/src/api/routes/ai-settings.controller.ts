import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import {
  AiSettingsManager,
  normalizeProviderId,
  qualifyProviderId,
} from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { SaveGovernanceDto } from '@gitroom/nestjs-libraries/dtos/ai-settings/governance.dto';
import { AIProviderAdapter } from '@gitroom/nestjs-libraries/ai/ai-provider.interface';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { ProviderHealthService } from '@gitroom/nestjs-libraries/ai/governance/provider-health.service';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';
import { PROVIDER_KERNEL } from '@gitroom/nestjs-libraries/providers/providers.module';
import { ProviderKernel, DEFAULT_VERSION, parseQualified, qualify } from '@gitroom/provider-kernel';
import {
  SaveAiProviderDto,
  TestAiProviderDto,
  SetActiveAiProviderDto,
  PreviewAiProviderDto,
  SaveRagSettingsDto,
  SaveMediaProviderDto,
  TriggerRagBackfillDto,
  UpdateSecretSettingsDto,
  UpsertOrgProviderConfigDto,
} from '@gitroom/nestjs-libraries/dtos/providers/admin-ai-settings.dtos';

// PROVIDER_REMEDIATION 0.1a/0.1b + 3.2: this controller writes the platform-global
// AIProviderConfig/AISystemSettings singletons and, via :orgId path params, ANY
// tenant's AIOrgProviderConfig. It was gated only by `@RequirePermission('ai-config',
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
    private _guardrails: GuardrailService,
    private _budgetService: BudgetService,
    private _ragService: RagService,
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    @Optional()
    @Inject(PROVIDER_KERNEL)
    private _kernel?: ProviderKernel,
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

  // Enumerate the registered AI adapters (one per provider id) — replaces the
  // legacy in-memory registry enumeration.
  private _listAdapters(): AIProviderAdapter[] {
    const seen = new Set<string>();
    const out: AIProviderAdapter[] = [];
    for (const manifest of this._kernel?.listManifests('ai') ?? []) {
      if (seen.has(manifest.providerId)) continue;
      seen.add(manifest.providerId);
      const adapter = this._resolveAdapter(manifest.providerId, manifest.version);
      if (adapter) out.push(adapter);
    }
    return out;
  }

  @Get('/providers')
  @RequirePermission('ai-config', 'manage')
  async listProviders(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    return this._aiSettingsService.listProviderCatalog();
  }

  @Get('/providers/:identifier')
  @RequirePermission('ai-config', 'manage')
  async getProvider(
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string,
    @Query('version') version?: string,
  ) {
    this._assertSuperAdmin(user);
    const adapter = this._resolveAdapter(identifier, version);
    if (!adapter) throw new BadRequestException('Unknown provider');

    const config = await this._aiSettingsService.getProviderConfigByIdentifier(identifier);
    const isConfigured = this._aiSettingsService.isProviderConfigured(adapter, config);

    let creds: Record<string, string> = {};
    if (config) {
      try {
        const d = this._aiSettingsService.decryptProviderConfig(config);
        creds = d?.credentials || {};
      } catch { /* use empty creds */ }
    }
    const models = await adapter.listModels(creds);
    const meta = this._aiSettingsService.getProviderVersionMeta(identifier, version);

    return {
      identifier: adapter.identifier,
      name: adapter.name,
      type: adapter.type,
      capabilities: adapter.capabilities,
      privacy: adapter.privacy,
      credentialFields: meta.credentialFields ?? adapter.credentialFields,
      enabled: config?.enabled || false,
      isConfigured,
      defaultModel: config?.defaultModel || '',
      reasoningModel: config?.reasoningModel || '',
      extraConfig: this._aiSettingsService.safeJson(config?.extraConfig),
      models,
      ...meta,
    };
  }

  @Put('/providers/:identifier')
  @RequirePermission('ai-config', 'manage')
  async saveProvider(
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string,
    @Body() body: SaveAiProviderDto,
  ) {
    this._assertSuperAdmin(user);
    const adapter = this._resolveAdapter(identifier);
    if (!adapter) throw new BadRequestException('Unknown provider');

    const before = await this._aiSettingsService.getProviderConfigByIdentifier(identifier);
    const result = await this._aiSettingsService.upsertProviderConfig(identifier, {
      enabled: body.enabled,
      credentials: body.credentials,
      defaultModel: body.defaultModel,
      reasoningModel: body.reasoningModel,
      extraConfig: body.extraConfig,
    });

    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'update-provider',
      detail: JSON.stringify({
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

    await this._aiSettingsManager.refreshCache();

    return { identifier, enabled: result.enabled, updatedAt: result.updatedAt };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('/providers/:identifier/test')
  @RequirePermission('ai-config', 'manage')
  async testProvider(
    @GetUserFromRequest() user: User,
    @Param('identifier') identifier: string,
    @Body() body: TestAiProviderDto,
  ) {
    this._assertSuperAdmin(user);
    const adapter = this._resolveAdapter(identifier);
    if (!adapter) throw new BadRequestException('Unknown provider');

    let creds = body.credentials || {};
    if (!creds || Object.keys(creds).length === 0) {
      try {
        const config = await this._aiSettingsService.getProviderConfigByIdentifier(identifier);
        const decrypted = config ? this._aiSettingsService.decryptProviderConfig(config) : undefined;
        creds = decrypted?.credentials || {};
      } catch (err) {
        throw new HttpException('Failed to decrypt provider credentials — JWT_SECRET may have changed', HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    // 3.1: validateCredentials returns { ok:false } for transport failures but
    // PROPAGATES an SSRF rejection ("Blocked URL") — map that to a clean 400
    // instead of an unhandled 500 (parity with the org-AI test route).
    try {
      return await adapter.validateCredentials(creds);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Put('/active')
  @RequirePermission('ai-config', 'manage')
  async setActive(
    @GetUserFromRequest() user: User,
    @Body() body: SetActiveAiProviderDto,
  ) {
    this._assertSuperAdmin(user);
    if (!body.provider) {
      await this._aiSettingsService.upsertSystemSettings({
        activeProvider: null,
        activeModel: null,
      });

      await this._aiSettingsService.createAuditLog({
        userId: user.id,
        action: 'set-active',
        detail: JSON.stringify({ provider: null, model: null }),
      });

      await this._aiSettingsManager.refreshCache();

      return { activeProvider: null, activeModel: null };
    }

    const { providerId, version: explicitVersion } = parseQualified(body.provider);
    const adapter = this._resolveAdapter(providerId, explicitVersion);
    if (!adapter) throw new BadRequestException('Unknown provider');
    if (!body.model) throw new BadRequestException('model is required');

    const config = await this._aiSettingsService.getProviderConfigByIdentifier(providerId);
    if (!config?.enabled || !this._aiSettingsService.isProviderConfigured(adapter, config)) {
      throw new BadRequestException(
        'Provider must be enabled and configured before it can be activated',
      );
    }

    const version =
      explicitVersion ??
      this._kernel?.latestActive('ai', providerId)?.manifest.version ??
      DEFAULT_VERSION;
    const qualifiedProvider = qualify(providerId, version);

    await this._aiSettingsService.upsertSystemSettings({
      activeProvider: qualifiedProvider,
      activeModel: body.model,
    });

    await this._aiSettingsService.createAuditLog({
      userId: user.id,
      action: 'set-active',
      detail: JSON.stringify({ provider: qualifiedProvider, model: body.model }),
    });

    await this._aiSettingsManager.refreshCache();

    return { activeProvider: providerId, activeModel: body.model };
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
      rateLimitSettings: safeParse(settings.rateLimitSettings),
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
      rateLimitSettings: body.rateLimitSettings,
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
    const settings = await this._aiSettingsManager.getSettings();
    return {
      hasActiveGlobalConfig: !!settings?.activeProvider,
      activeProvider: settings?.activeProvider || null,
      activeModel: settings?.activeModel || null,
      providerHealth: this._providerHealth.getAllHealth(),
    };
  }

  @Post('/providers/:id/preview')
  @RequirePermission('ai-config', 'manage')
  async previewProvider(
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: PreviewAiProviderDto,
  ) {
    this._assertSuperAdmin(user);
    const adapter = this._resolveAdapter(id);
    if (!adapter) throw new BadRequestException('Unknown provider');

    const budgetCheck = await this._budgetService.checkBudget('preview', undefined);
    if (!budgetCheck.allowed) {
      throw new HttpException(
        budgetCheck.reason || 'Budget exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const config = await this._aiSettingsService.getProviderConfigByIdentifier(id);
    let creds: Record<string, string> = {};
    try {
      const decrypted = config ? this._aiSettingsService.decryptProviderConfig(config) : undefined;
      creds = decrypted?.credentials || {};
    } catch (err) {
      throw new HttpException('Failed to decrypt provider credentials — JWT_SECRET may have changed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const modelId = config?.defaultModel || 'gpt-4o-mini';
    const rawPrompt = body.prompt || 'Generate a short one-sentence response: Hello, how can I help you?';

    const checkedPrompt = await this._guardrails.checkInput(rawPrompt);
    const model = adapter.createLanguageModel(creds, modelId);
    const result = await (model as any).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: checkedPrompt }] }],
    });

    const extractText = (r: any): string =>
      typeof r?.text === 'string'
        ? r.text
        : (Array.isArray(r?.content) ? r.content : [])
            .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
            .map((p: any) => p.text)
            .join('');
    const outputText = extractText(result);
    const checked = await this._guardrails.checkOutput(outputText);

    await this._aiSettingsService.createSpendLog({
      provider: id,
      model: modelId,
      scope: 'preview',
      inputTokens: result.usage?.inputTokens ?? result.usage?.promptTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? result.usage?.completionTokens ?? 0,
      costUsd: 0,
    });

    return { text: checked };
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

  @Get('/media-providers')
  @RequirePermission('ai-config', 'manage')
  async listMediaProviders(@GetUserFromRequest() user: User) {
    this._assertSuperAdmin(user);
    const adapters = this._listAdapters().filter(
      (a) =>
        typeof a.createImageModel === 'function' ||
        typeof a.createSpeechModel === 'function' ||
        (a.capabilities?.image || a.capabilities?.speech),
    );
    const dbConfigs = await this._aiSettingsService.getProviderConfigs();
    const dbConfigMap = new Map(dbConfigs.map((c) => [c.identifier, c]));

    // Per-org media-provider state lives in MediaProviderConfig (Settings →
    // Media); the old ragSettings.mediaProviders blob is migrated + removed.
    // "enabled" here means enabled in at least one org.
    const enabledIdentifiers = new Set(
      await this._orgMediaProviderSettings.getEnabledIdentifiers(),
    );

    return adapters.map((adapter) => {
      const dbConfig = dbConfigMap.get(adapter.identifier);
      const isConfigured = this._aiSettingsService.isProviderConfigured(adapter, dbConfig);

      const hasImage =
        typeof adapter.createImageModel === 'function' ||
        adapter.capabilities?.image;
      const hasSpeech =
        typeof adapter.createSpeechModel === 'function' ||
        adapter.capabilities?.speech;
      const hasEmbedding =
        typeof adapter.createEmbeddingModel === 'function' ||
        adapter.capabilities?.embeddings;

      const supportedOperations: string[] = [];
      if (hasImage) supportedOperations.push('image');
      if (hasSpeech) supportedOperations.push('tts', 'stt');
      if (hasEmbedding) supportedOperations.push('embedding');

      return {
        identifier: adapter.identifier,
        name: adapter.name,
        capabilities: adapter.capabilities,
        isConfigured,
        enabled: enabledIdentifiers.has(adapter.identifier),
        operations: [] as string[],
        supportedOperations,
        c2paAvailable: false,
      };
    });
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
