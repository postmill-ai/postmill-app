import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';

const mockAdapter = {
  identifier: 'openai',
  name: 'OpenAI',
  type: 'direct',
  credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
  capabilities: { text: true, image: true, vision: true, embeddings: true, speech: true, tools: true },
  privacy: { dataRetention: '30 days', trainingOnData: false, description: '' },
  listModels: vi.fn().mockResolvedValue([
    { id: 'gpt-4.1', label: 'GPT-4.1', kind: 'text', capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true } },
  ]),
  validateCredentials: vi.fn().mockResolvedValue({ ok: true }),
  createLanguageModel: vi.fn(() => ({ doGenerate: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'test' }], usage: { inputTokens: 10, outputTokens: 20 } }) })),
};

// The legacy AIProviderRegistry was deleted; the controller now enumerates via the
// ProviderKernel (listManifests) and resolves adapters via ProviderResolutionService.
const mockResolveAI = vi.fn().mockReturnValue(mockAdapter);
const mockKernel = {
  listManifests: vi.fn().mockReturnValue([{ providerId: 'openai', version: 'v1' }]),
  versions: vi.fn().mockReturnValue([]),
  latestActive: vi.fn().mockReturnValue(undefined),
};

vi.mock('@gitroom/nestjs-libraries/providers/provider-resolution.service', () => ({
  ProviderResolutionService: class {
    resolveAI = mockResolveAI;
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class {
    getProviderConfigs = vi.fn().mockResolvedValue([]);
    getProviderConfigByIdentifier = vi.fn().mockResolvedValue(null);
    upsertProviderConfig = vi.fn().mockImplementation((id: string, data: any) => ({ identifier: id, ...data, enabled: true, updatedAt: new Date() }));
    upsertSystemSettings = vi.fn().mockResolvedValue({});
    getSystemSettings = vi.fn().mockResolvedValue(null);
    getDecryptedSystemSettings = vi.fn().mockResolvedValue(null);
    createAuditLog = vi.fn().mockResolvedValue({});
    createSpendLog = vi.fn().mockResolvedValue({});
    getSpendSummary = vi.fn().mockResolvedValue([]);
    getUsageSummary = vi.fn().mockResolvedValue({});
    getAuditLogs = vi.fn().mockResolvedValue([]);
    decryptProviderConfig = vi.fn().mockReturnValue({ credentials: { apiKey: 'sk-test' } });
    listProviderCatalog = vi.fn().mockResolvedValue([]);
    getProviderVersionMeta = vi.fn().mockReturnValue({ version: 'v1', status: 'active', availableVersions: [], credentialFields: [{ key: 'apiKey', required: true }] });
    isProviderConfigured = vi.fn().mockReturnValue(true);
    redactSensitive = vi.fn().mockImplementation((v: any) => v);
    safeJson = vi.fn().mockReturnValue(null);
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class {
    getSettings = vi.fn().mockResolvedValue({ activeProvider: null, activeModel: null });
    refreshCache = vi.fn();
  },
  normalizeProviderId: vi.fn((id?: string | null) => id || null),
  qualifyProviderId: vi.fn((id?: string | null) => id || null),
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/provider-health.service', () => ({
  ProviderHealthService: class {
    getAllHealth = vi.fn().mockReturnValue({});
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/guardrail.service', () => ({
  GuardrailService: class {
    checkInput = vi.fn().mockImplementation(async (text: string) => text);
    checkOutput = vi.fn().mockImplementation(async (text: string) => text);
  },
}));

const mockBudgetService = {
  checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
};
vi.mock('@gitroom/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class {
    checkBudget = mockBudgetService.checkBudget;
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/rag.service', () => ({
  RagService: class {
    backfill = vi.fn().mockResolvedValue({ indexed: 0 });
  },
}));

import { AiSettingsController } from './ai-settings.controller';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { ProviderHealthService } from '@gitroom/nestjs-libraries/ai/governance/provider-health.service';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import type { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';

const superAdmin = { id: 'admin-1', isSuperAdmin: true } as any;
const regularUser = { id: 'user-1', isSuperAdmin: false } as any;

describe('AiSettingsController', () => {
  let controller: AiSettingsController;
  let resolution: ProviderResolutionService;
  let aiSettings: AiSettingsService;
  let settingsManager: AiSettingsManager;
  let health: ProviderHealthService;
  let guardrails: GuardrailService;
  let budget: BudgetService;
  let rag: RagService;
  let orgMediaProviderSettings: {
    upsert: ReturnType<typeof vi.fn>;
    getEnabledIdentifiers: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default kernel/resolution behaviour after clearAllMocks (per-test overrides leak otherwise).
    mockResolveAI.mockReturnValue(mockAdapter);
    mockKernel.listManifests.mockReturnValue([{ providerId: 'openai', version: 'v1' }]);
    mockKernel.versions.mockReturnValue([]);
    mockKernel.latestActive.mockReturnValue(undefined);
    resolution = new (ProviderResolutionService as any)();
    aiSettings = new (AiSettingsService as any)();
    settingsManager = new (AiSettingsManager as any)();
    health = new (ProviderHealthService as any)();
    guardrails = new (GuardrailService as any)();
    budget = new (BudgetService as any)();
    rag = new (RagService as any)();
    orgMediaProviderSettings = {
      upsert: vi.fn().mockResolvedValue({}),
      getEnabledIdentifiers: vi.fn().mockResolvedValue([]),
    };

    controller = new AiSettingsController(
      aiSettings as any,
      settingsManager as any,
      resolution as any,
      health as any,
      guardrails as any,
      budget as any,
      rag as any,
      orgMediaProviderSettings as unknown as OrgMediaProviderSettingsService,
      mockKernel as any,
    );
  });

  describe('listProviders', () => {
    it('returns the provider catalog from the service', async () => {
      (aiSettings as any).listProviderCatalog.mockResolvedValue([
        { identifier: 'openai', name: 'OpenAI', capabilities: {}, isConfigured: true },
      ]);

      const result = await controller.listProviders(superAdmin);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('identifier');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('capabilities');
      expect(result[0]).toHaveProperty('isConfigured');
      expect(aiSettings.listProviderCatalog).toHaveBeenCalled();
    });

    it('is gated with RequirePermission decorator', () => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        controller.listProviders,
      );
      expect(metadata).toEqual({ resource: 'ai-config', action: 'manage' });
    });
  });

  describe('getProvider', () => {
    it('returns provider details with model list', async () => {
      const result = await controller.getProvider(superAdmin, 'openai');
      expect(result).toHaveProperty('models');
      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('gpt-4.1');
    });

    it('delegates extraConfig redaction to the service', async () => {
      const rawExtraConfig = JSON.stringify({
        baseURL: 'https://api.example.test/v1',
        apiKey: 'sk-leak',
        nested: { accessToken: 'tok-leak', region: 'us-east-1' },
      });
      (aiSettings as any).getProviderConfigByIdentifier.mockResolvedValue({
        identifier: 'openai',
        enabled: true,
        credentials: 'encrypted',
        defaultModel: 'gpt-4.1',
        imageModel: null,
        extraConfig: rawExtraConfig,
      });
      (aiSettings as any).safeJson.mockReturnValue({
        baseURL: 'https://api.example.test/v1',
        apiKey: '[REDACTED]',
        nested: { accessToken: '[REDACTED]', region: 'us-east-1' },
      });

      const result = await controller.getProvider(superAdmin, 'openai');

      expect(aiSettings.safeJson).toHaveBeenCalledWith(rawExtraConfig);
      expect(result.extraConfig).toEqual({
        baseURL: 'https://api.example.test/v1',
        apiKey: '[REDACTED]',
        nested: { accessToken: '[REDACTED]', region: 'us-east-1' },
      });
    });

    it('throws BadRequestException for unknown provider', async () => {
      mockResolveAI.mockReturnValue(undefined);
      await expect(controller.getProvider(superAdmin, 'nonexistent')).rejects.toThrow(BadRequestException);
    });
  });

  describe('saveProvider', () => {
    it('saves provider config and writes audit log', async () => {
      const result = await controller.saveProvider(superAdmin, 'openai', {
        enabled: true,
        credentials: { apiKey: 'sk-new' },
        defaultModel: 'gpt-4.1',
      });
      expect(result.identifier).toBe('openai');
      expect(aiSettings.createAuditLog).toHaveBeenCalled();
    });
  });

  describe('testProvider', () => {
    it('calls validateCredentials on the adapter', async () => {
      const result = await controller.testProvider(superAdmin, 'openai', { credentials: { apiKey: 'sk-test' } });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('setActive', () => {
    it('sets the active provider and model', async () => {
      (aiSettings as any).getProviderConfigByIdentifier.mockResolvedValue({
        identifier: 'openai',
        enabled: true,
        credentials: 'encrypted',
      });

      const result = await controller.setActive(superAdmin, { provider: 'openai', model: 'gpt-4.1' });
      expect(result.activeProvider).toBe('openai');
      expect(result.activeModel).toBe('gpt-4.1');
    });

    it('clears active provider to restore env fallback mode', async () => {
      const result = await controller.setActive(superAdmin, { provider: null, model: null });

      expect(aiSettings.upsertSystemSettings).toHaveBeenCalledWith({
        activeProvider: null,
        activeModel: null,
      });
      expect(result).toEqual({ activeProvider: null, activeModel: null });
    });

    it('rejects activating a provider without enabled stored credentials', async () => {
      (aiSettings as any).getProviderConfigByIdentifier.mockResolvedValue({
        identifier: 'openai',
        enabled: false,
        credentials: null,
      });

      await expect(
        controller.setActive(superAdmin, { provider: 'openai', model: 'gpt-4.1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getHealth', () => {
    it('returns health status', async () => {
      const result = await controller.getHealth(superAdmin);
      expect(result).toHaveProperty('hasActiveGlobalConfig');
      expect(result).toHaveProperty('activeProvider');
      expect(result).toHaveProperty('providerHealth');
    });
  });

  describe('triggerRagBackfill', () => {
    it('triggers backfill and records spend log', async () => {
      const result = await controller.triggerRagBackfill(superAdmin, { organizationId: 'org-1' });
      expect(result.status).toBe('completed');
      expect((result as { indexed: number }).indexed).toBe(0);
      expect(aiSettings.createSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'backfill' }),
      );
    });
  });

  // PROVIDER_REMEDIATION 0.1a: every handler writes platform-global singletons and
  // must be super-admin only (RBAC 'ai-config:manage' is granted to every org owner).
  describe('super-admin gating (0.1a)', () => {
    it('rejects a non-super-admin on setActive', async () => {
      await expect(
        controller.setActive(regularUser, { provider: 'openai', model: 'gpt-4.1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(aiSettings.upsertSystemSettings).not.toHaveBeenCalled();
    });

    it('rejects a non-super-admin on saveProvider', async () => {
      await expect(
        controller.saveProvider(regularUser, 'openai', { enabled: true, credentials: { apiKey: 'sk' } }),
      ).rejects.toThrow(ForbiddenException);
      expect(aiSettings.upsertProviderConfig).not.toHaveBeenCalled();
    });

    it('rejects a non-super-admin on saveGovernance', async () => {
      await expect(
        controller.saveGovernance(regularUser, {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a non-super-admin on updateSecretSettings', async () => {
      await expect(
        controller.updateSecretSettings(regularUser, { secretSettings: { a: 'b' } }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a non-super-admin on triggerRagBackfill', async () => {
      await expect(
        controller.triggerRagBackfill(regularUser, { organizationId: 'org-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a super-admin on setActive', async () => {
      (aiSettings as any).getProviderConfigByIdentifier.mockResolvedValue({
        identifier: 'openai',
        enabled: true,
        credentials: 'encrypted',
      });
      await expect(
        controller.setActive(superAdmin, { provider: 'openai', model: 'gpt-4.1' }),
      ).resolves.toBeTruthy();
    });
  });

  // PROVIDER_REMEDIATION 0.1b: the :orgId path handlers are a cross-org IDOR (write
  // ANY tenant's AI credentials + mirror into their MediaProviderConfig). The
  // super-admin gate must fire BEFORE any service call so no victim row is touched.
  describe('org-providers cross-org IDOR gating (0.1b)', () => {
    it('rejects a non-super-admin reading another org via listOrgProviderConfigs', async () => {
      (aiSettings as any).getOrgProviderConfigs = vi.fn();
      await expect(
        controller.listOrgProviderConfigs(regularUser, 'org-B'),
      ).rejects.toThrow(ForbiddenException);
      expect((aiSettings as any).getOrgProviderConfigs).not.toHaveBeenCalled();
    });

    it('rejects a non-super-admin writing another org via upsertOrgProviderConfig', async () => {
      (aiSettings as any).getOrgProviderConfig = vi.fn();
      (aiSettings as any).upsertOrgProviderConfig = vi.fn();
      await expect(
        controller.upsertOrgProviderConfig(regularUser, 'org-B', 'openai', {
          credentials: { apiKey: 'sk', baseUrl: 'https://attacker.example' },
        }),
      ).rejects.toThrow(ForbiddenException);
      expect((aiSettings as any).upsertOrgProviderConfig).not.toHaveBeenCalled();
      // No mirrored MediaProviderConfig write either.
      expect(orgMediaProviderSettings.upsert).not.toHaveBeenCalled();
    });

    it('rejects a non-super-admin deleting another org config', async () => {
      (aiSettings as any).deleteOrgProviderConfig = vi.fn();
      await expect(
        controller.deleteOrgProviderConfig(regularUser, 'org-B', 'openai'),
      ).rejects.toThrow(ForbiddenException);
      expect((aiSettings as any).deleteOrgProviderConfig).not.toHaveBeenCalled();
    });
  });

  describe('listOrgProviderConfigs', () => {
    it('delegates extraConfig redaction to the service', async () => {
      const rawExtraConfig = JSON.stringify({ webhookSecret: 'secret', label: 'prod' });
      (aiSettings as any).getOrgProviderConfigs = vi.fn().mockResolvedValue([
        {
          id: 'cfg-1',
          organizationId: 'org-1',
          identifier: 'openai',
          enabled: true,
          defaultModel: 'gpt-4.1',
          imageModel: null,
          extraConfig: rawExtraConfig,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
      (aiSettings as any).safeJson.mockReturnValue({
        webhookSecret: '[REDACTED]',
        label: 'prod',
      });

      const result = await controller.listOrgProviderConfigs(superAdmin, 'org-1');

      expect(aiSettings.safeJson).toHaveBeenCalledWith(rawExtraConfig);
      expect(result[0].extraConfig).toEqual({
        webhookSecret: '[REDACTED]',
        label: 'prod',
      });
    });
  });

  describe('coverage of remaining handlers', () => {
    it('getGovernance parses and returns settings', async () => {
      (aiSettings as any).getSystemSettings.mockResolvedValue({
        guardrailSettings: JSON.stringify({ enabled: true }),
        budgetSettings: JSON.stringify({ monthlyCap: 100 }),
        rateLimitSettings: null,
        observability: null,
        mcpSettings: null,
        ragSettings: null,
        fallbackProvider: 'openai',
        fallbackImageProvider: null,
      });

      const result = await controller.getGovernance(superAdmin);

      expect(result.guardrailSettings).toEqual({ enabled: true });
      expect(result.budgetSettings).toEqual({ monthlyCap: 100 });
      expect(result.fallbackProvider).toBe('openai');
      expect(result.fallbackImageProvider).toBeNull();
    });

    it('getGovernance returns empty object when no settings', async () => {
      (aiSettings as any).getSystemSettings.mockResolvedValue(null);
      const result = await controller.getGovernance(superAdmin);
      expect(result).toEqual({});
    });

    it('saveGovernance writes settings and audit log', async () => {
      const body = {
        guardrailSettings: { enabled: true },
        budgetSettings: { monthlyCap: 100 },
        rateLimitSettings: {},
        observability: {},
        mcpSettings: {},
        ragSettings: {},
        fallbackProvider: 'openai',
        fallbackImageProvider: 'dall-e',
      };

      const result = await controller.saveGovernance(superAdmin, body as any);

      expect(aiSettings.upsertSystemSettings).toHaveBeenCalled();
      expect(aiSettings.createAuditLog).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('getAudit returns audit logs', async () => {
      (aiSettings as any).getAuditLogs.mockResolvedValue([{ id: 'audit-1' }]);
      const result = await controller.getAudit(superAdmin);
      expect(result).toEqual([{ id: 'audit-1' }]);
    });

    it('getRagSettings parses stored settings', async () => {
      (aiSettings as any).getSystemSettings.mockResolvedValue({
        ragSettings: JSON.stringify({ vectorStore: 'pgvector' }),
      });
      const result = await controller.getRagSettings(superAdmin);
      expect(result).toEqual({ vectorStore: 'pgvector' });
    });

    it('getRagSettings returns empty object when unset', async () => {
      (aiSettings as any).getSystemSettings.mockResolvedValue(null);
      const result = await controller.getRagSettings(superAdmin);
      expect(result).toEqual({});
    });

    it('saveRagSettings persists valid vectorStore', async () => {
      const result = await controller.saveRagSettings(superAdmin, {
        ragSettings: { vectorStore: 'qdrant' },
      } as any);
      expect(aiSettings.upsertSystemSettings).toHaveBeenCalledWith({
        ragSettings: { vectorStore: 'qdrant' },
      });
      expect(result).toEqual({ success: true });
    });

    it('saveRagSettings rejects invalid vectorStore', async () => {
      await expect(
        controller.saveRagSettings(superAdmin, {
          ragSettings: { vectorStore: 'pinecone' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('listMediaProviders returns media-capable adapters', async () => {
      const result = await controller.listMediaProviders(superAdmin);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('identifier');
      expect(result[0]).toHaveProperty('supportedOperations');
    });

    it('saveMediaProvider mirrors enabled flag to every org', async () => {
      (aiSettings as any).getAllOrgIds = vi.fn().mockResolvedValue(['org-1', 'org-2']);
      const result = await controller.saveMediaProvider(superAdmin, 'openai', {
        enabled: true,
        operations: ['image'],
        c2paAvailable: false,
      } as any);
      expect(orgMediaProviderSettings.upsert).toHaveBeenCalledTimes(2);
      expect(result.identifier).toBe('openai');
    });

    it('updateSecretSettings merges and persists secrets', async () => {
      (aiSettings as any).getDecryptedSystemSettings.mockResolvedValue({
        secretSettings: { existing: 'value' },
      });
      const result = await controller.updateSecretSettings(superAdmin, {
        secretSettings: { newKey: 'newValue' },
      } as any);
      expect(aiSettings.upsertSystemSettings).toHaveBeenCalledWith({
        secretSettings: { existing: 'value', newKey: 'newValue' },
      });
      expect(result).toEqual({ success: true });
    });

    it('previewProvider returns generated and checked output', async () => {
      const result = await controller.previewProvider(superAdmin, 'openai', {
        prompt: 'Hello',
      } as any);
      expect(result).toHaveProperty('text');
      expect(aiSettings.createSpendLog).toHaveBeenCalled();
    });

    it('previewProvider rejects when budget is exceeded', async () => {
      mockBudgetService.checkBudget.mockResolvedValueOnce({
        allowed: false,
        reason: 'Budget exceeded',
      });
      await expect(
        controller.previewProvider(superAdmin, 'openai', { prompt: 'Hello' } as any),
      ).rejects.toThrow(expect.objectContaining({ status: 429 }));
    });

    it('upsertOrgProviderConfig writes config and audit log', async () => {
      (aiSettings as any).getOrgProviderConfig = vi.fn().mockResolvedValue(null);
      (aiSettings as any).upsertOrgProviderConfig = vi.fn().mockResolvedValue({
        identifier: 'openai',
        enabled: true,
        updatedAt: new Date(),
      });

      const result = await controller.upsertOrgProviderConfig(
        superAdmin,
        'org-1',
        'openai',
        { enabled: true, credentials: { apiKey: 'sk' } } as any,
      );

      expect(aiSettings.upsertOrgProviderConfig).toHaveBeenCalled();
      expect(aiSettings.createAuditLog).toHaveBeenCalled();
      expect(result.identifier).toBe('openai');
    });

    it('upsertOrgProviderConfig mirrors OpenAI credentials to MediaProviderConfig', async () => {
      (aiSettings as any).getOrgProviderConfig = vi.fn().mockResolvedValue(null);
      (aiSettings as any).upsertOrgProviderConfig = vi.fn().mockResolvedValue({
        identifier: 'openai',
        enabled: true,
        updatedAt: new Date(),
      });

      await controller.upsertOrgProviderConfig(
        superAdmin,
        'org-1',
        'openai',
        { enabled: true, credentials: { apiKey: 'sk' } } as any,
      );

      expect(orgMediaProviderSettings.upsert).toHaveBeenCalledWith(
        'org-1',
        'openai',
        expect.objectContaining({ enabled: true, credentials: { apiKey: 'sk' } }),
      );
    });

    it('deleteOrgProviderConfig removes config and logs', async () => {
      (aiSettings as any).deleteOrgProviderConfig = vi.fn().mockResolvedValue({});
      const result = await controller.deleteOrgProviderConfig(superAdmin, 'org-1', 'openai');
      expect(aiSettings.deleteOrgProviderConfig).toHaveBeenCalledWith('org-1', 'openai');
      expect(result).toEqual({ success: true });
    });

    it('_resolveAdapter returns undefined when resolution throws', async () => {
      mockResolveAI.mockImplementationOnce(() => {
        throw new Error('kernel not ready');
      });
      // getProvider uses _resolveAdapter internally and should map undefined to BadRequest
      await expect(controller.getProvider(superAdmin, 'openai')).rejects.toThrow(BadRequestException);
    });
  });
});
