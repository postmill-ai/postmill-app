import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

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

// The legacy AIProviderRegistry was deleted; the controller now resolves adapters
// via ProviderResolutionService.
const mockResolveAI = vi.fn().mockReturnValue(mockAdapter);

vi.mock('@postmill-ai/nestjs-libraries/providers/provider-resolution.service', () => ({
  ProviderResolutionService: class {
    resolveAI = mockResolveAI;
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class {
    upsertSystemSettings = vi.fn().mockResolvedValue({});
    getSystemSettings = vi.fn().mockResolvedValue(null);
    getDecryptedSystemSettings = vi.fn().mockResolvedValue(null);
    createAuditLog = vi.fn().mockResolvedValue({});
    createSpendLog = vi.fn().mockResolvedValue({});
    getSpendSummary = vi.fn().mockResolvedValue([]);
    getUsageSummary = vi.fn().mockResolvedValue({});
    getAuditLogs = vi.fn().mockResolvedValue([]);
    redactSensitive = vi.fn().mockImplementation((v: any) => v);
    safeJson = vi.fn().mockReturnValue(null);
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class {
    getSettings = vi.fn().mockResolvedValue({});
    refreshCache = vi.fn();
  },
  normalizeProviderId: vi.fn((id?: string | null) => id || null),
  qualifyProviderId: vi.fn((id?: string | null) => id || null),
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/provider-health.service', () => ({
  ProviderHealthService: class {
    getAllHealth = vi.fn().mockReturnValue({});
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/ai/governance/rag.service', () => ({
  RagService: class {
    backfill = vi.fn().mockResolvedValue({ indexed: 0 });
  },
}));

import { AiSettingsController } from './ai-settings.controller';
import { ProviderResolutionService } from '@postmill-ai/nestjs-libraries/providers/provider-resolution.service';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@postmill-ai/nestjs-libraries/ai/ai-settings.manager';
import { ProviderHealthService } from '@postmill-ai/nestjs-libraries/ai/governance/provider-health.service';
import { RagService } from '@postmill-ai/nestjs-libraries/ai/governance/rag.service';
import type { OrgMediaProviderSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';

const superAdmin = { id: 'admin-1', isSuperAdmin: true } as any;
const regularUser = { id: 'user-1', isSuperAdmin: false } as any;

describe('AiSettingsController', () => {
  let controller: AiSettingsController;
  let resolution: ProviderResolutionService;
  let aiSettings: AiSettingsService;
  let settingsManager: AiSettingsManager;
  let health: ProviderHealthService;
  let rag: RagService;
  let orgMediaProviderSettings: {
    upsert: ReturnType<typeof vi.fn>;
    getEnabledIdentifiers: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default resolution behaviour after clearAllMocks (per-test overrides leak otherwise).
    mockResolveAI.mockReturnValue(mockAdapter);
    resolution = new (ProviderResolutionService as any)();
    aiSettings = new (AiSettingsService as any)();
    settingsManager = new (AiSettingsManager as any)();
    health = new (ProviderHealthService as any)();
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
      rag as any,
      orgMediaProviderSettings as unknown as OrgMediaProviderSettingsService,
    );
  });

  describe('getHealth', () => {
    it('returns provider health only (legacy activeProvider/activeModel fields removed)', async () => {
      const result = await controller.getHealth(superAdmin);
      expect(result).toHaveProperty('providerHealth');
      expect(result).not.toHaveProperty('activeProvider');
      expect(result).not.toHaveProperty('activeModel');
      expect(result).not.toHaveProperty('hasActiveGlobalConfig');
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
    it('rejects a non-super-admin on saveGovernance', async () => {
      await expect(
        controller.saveGovernance(regularUser, {} as any),
      ).rejects.toThrow(ForbiddenException);
      expect(aiSettings.upsertSystemSettings).not.toHaveBeenCalled();
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

    it('allows a super-admin on saveGovernance', async () => {
      await expect(
        controller.saveGovernance(superAdmin, { budgetSettings: { monthlyCap: 100 } } as any),
      ).resolves.toEqual({ success: true });
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
    it('getGovernance parses and returns settings (no rateLimitSettings)', async () => {
      (aiSettings as any).getSystemSettings.mockResolvedValue({
        guardrailSettings: JSON.stringify({ enabled: true }),
        budgetSettings: JSON.stringify({ monthlyCap: 100 }),
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
      expect(result).not.toHaveProperty('rateLimitSettings');
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

    it('saveMediaProvider rejects an unknown provider', async () => {
      mockResolveAI.mockReturnValue(undefined);
      await expect(
        controller.saveMediaProvider(superAdmin, 'nonexistent', { enabled: true } as any),
      ).rejects.toThrow(BadRequestException);
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
      // saveMediaProvider uses _resolveAdapter internally and should map undefined to BadRequest
      await expect(
        controller.saveMediaProvider(superAdmin, 'openai', { enabled: true } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
