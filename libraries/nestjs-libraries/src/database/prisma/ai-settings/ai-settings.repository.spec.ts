import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function() { return { model: {} }; }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AiSettingsRepository } from './ai-settings.repository';

describe('AiSettingsRepository', () => {
  let repository: AiSettingsRepository;

  let mockProviderConfig: Record<string, ReturnType<typeof vi.fn>>;
  let mockSystemSettings: Record<string, ReturnType<typeof vi.fn>>;
  let mockSpendLog: Record<string, ReturnType<typeof vi.fn>>;
  let mockAudit: Record<string, ReturnType<typeof vi.fn>>;
  let mockBrandProfile: Record<string, ReturnType<typeof vi.fn>>;
  let mockPromptTemplate: Record<string, ReturnType<typeof vi.fn>>;
  let mockMediaJob: Record<string, ReturnType<typeof vi.fn>>;
  let mockPromptLibraryItem: Record<string, ReturnType<typeof vi.fn>>;
  let mockContentIndex: Record<string, ReturnType<typeof vi.fn>>;
  let mockOrgProviderConfig: Record<string, ReturnType<typeof vi.fn>>;

  function makeRepoMock(modelName: string, methods: Record<string, ReturnType<typeof vi.fn>>) {
    const repo = new (PrismaRepository as any)();
    repo.model = { [modelName]: methods };
    return repo;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockProviderConfig = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    mockSystemSettings = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    };
    mockSpendLog = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    mockAudit = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    };
    mockBrandProfile = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    mockPromptTemplate = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    mockMediaJob = {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    };
    mockPromptLibraryItem = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    mockContentIndex = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    };
    mockOrgProviderConfig = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };

    repository = new AiSettingsRepository(
      makeRepoMock('aIProviderConfig', mockProviderConfig),
      makeRepoMock('aISystemSettings', mockSystemSettings),
      makeRepoMock('aISpendLog', mockSpendLog),
      makeRepoMock('aISettingsAudit', mockAudit),
      makeRepoMock('aIBrandProfile', mockBrandProfile),
      makeRepoMock('aIPromptTemplate', mockPromptTemplate),
      makeRepoMock('aIMediaJob', mockMediaJob),
      makeRepoMock('aIPromptLibraryItem', mockPromptLibraryItem),
      makeRepoMock('aIContentIndex', mockContentIndex),
      makeRepoMock('aIOrgProviderConfig', mockOrgProviderConfig),
    );
  });

  // ── AISystemSettings ──

  describe('getSystemSettings', () => {
    it('fetches the singleton row by id', async () => {
      const settings = { id: 'singleton', activeProvider: null };
      mockSystemSettings.findUnique.mockResolvedValue(settings);

      const result = await repository.getSystemSettings();

      expect(mockSystemSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'singleton' },
      });
      expect(result).toEqual(settings);
    });

    it('returns null when no singleton exists', async () => {
      mockSystemSettings.findUnique.mockResolvedValue(null);
      const result = await repository.getSystemSettings();
      expect(result).toBeNull();
    });
  });

  describe('upsertSystemSettings', () => {
    it('upserts with id=singleton, merging create and update', async () => {
      const data = { activeProvider: 'openai', scopeModels: '{}' };
      const upserted = { id: 'singleton', ...data };
      mockSystemSettings.upsert.mockResolvedValue(upserted);

      const result = await repository.upsertSystemSettings(data);

      expect(mockSystemSettings.upsert).toHaveBeenCalledWith({
        where: { id: 'singleton' },
        create: { id: 'singleton', ...data },
        update: data,
      });
      expect(result).toEqual(upserted);
    });
  });

  // ── AIProviderConfig ──

  describe('getProviderConfigs', () => {
    it('returns all provider configs', async () => {
      const configs = [
        { identifier: 'openai', enabled: true },
        { identifier: 'anthropic', enabled: false },
      ];
      mockProviderConfig.findMany.mockResolvedValue(configs);

      const result = await repository.getProviderConfigs();

      expect(mockProviderConfig.findMany).toHaveBeenCalledWith();
      expect(result).toEqual(configs);
    });

    it('returns empty array when no configs exist', async () => {
      mockProviderConfig.findMany.mockResolvedValue([]);
      const result = await repository.getProviderConfigs();
      expect(result).toEqual([]);
    });
  });

  describe('listProviderConfigs', () => {
    it('returns configs with limited fields ordered by createdAt desc', async () => {
      const configs = [{ id: '1', identifier: 'openai', enabled: true }];
      mockProviderConfig.findMany.mockResolvedValue(configs);

      const result = await repository.listProviderConfigs();

      expect(mockProviderConfig.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          identifier: true,
          enabled: true,
          defaultModel: true,
          reasoningModel: true,
          extraConfig: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(configs);
    });
  });

  describe('getProviderConfigByIdentifier', () => {
    it('returns a single config by identifier', async () => {
      const config = { identifier: 'openai', enabled: true };
      mockProviderConfig.findUnique.mockResolvedValue(config);

      const result = await repository.getProviderConfigByIdentifier('openai');

      expect(mockProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'openai', version: 'v1' } },
      });
      expect(result).toEqual(config);
    });

    it('returns null when identifier not found', async () => {
      mockProviderConfig.findUnique.mockResolvedValue(null);
      const result = await repository.getProviderConfigByIdentifier('unknown');
      expect(result).toBeNull();
    });
  });

  describe('upsertProviderConfig', () => {
    it('upserts with create having identifier + data and update with data only', async () => {
      const data = { enabled: true, credentials: 'enc', defaultModel: 'gpt-4' };
      const upserted = { identifier: 'openai', ...data };
      mockProviderConfig.upsert.mockResolvedValue(upserted);

      const result = await repository.upsertProviderConfig('openai', data);

      expect(mockProviderConfig.upsert).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'openai', version: 'v1' } },
        create: { identifier: 'openai', version: 'v1', ...data },
        update: data,
      });
      expect(result).toEqual(upserted);
    });

    it('upserts with optional fields omitted', async () => {
      const data = { enabled: false };
      mockProviderConfig.upsert.mockResolvedValue({ identifier: 'mini', ...data });

      await repository.upsertProviderConfig('mini', data);

      expect(mockProviderConfig.upsert).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'mini', version: 'v1' } },
        create: { identifier: 'mini', version: 'v1', enabled: false },
        update: { enabled: false },
      });
    });
  });

  describe('deleteProviderConfig', () => {
    it('deletes by identifier', async () => {
      const deleted = { identifier: 'openai' };
      mockProviderConfig.delete.mockResolvedValue(deleted);

      const result = await repository.deleteProviderConfig('openai');

      expect(mockProviderConfig.delete).toHaveBeenCalledWith({
        where: { identifier_version: { identifier: 'openai', version: 'v1' } },
      });
      expect(result).toEqual(deleted);
    });

    it('throws when identifier does not exist', async () => {
      mockProviderConfig.delete.mockRejectedValue(new Error('RecordNotFound'));
      await expect(repository.deleteProviderConfig('ghost')).rejects.toThrow('RecordNotFound');
    });
  });

  describe('getEnabledProviderConfigs', () => {
    it('fetches only enabled configs', async () => {
      const enabled = [{ identifier: 'openai', enabled: true }];
      mockProviderConfig.findMany.mockResolvedValue(enabled);

      const result = await repository.getEnabledProviderConfigs();

      expect(mockProviderConfig.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
      });
      expect(result).toEqual(enabled);
    });
  });

  // ── AISpendLog ──

  describe('createSpendLog', () => {
    it('creates a spend log entry', async () => {
      const data = {
        organizationId: 'org1',
        userId: 'u1',
        provider: 'openai',
        model: 'gpt-4',
        scope: 'chat',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      };
      const created = { id: 's1', ...data };
      mockSpendLog.create.mockResolvedValue(created);

      const result = await repository.createSpendLog(data);

      expect(mockSpendLog.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });
  });

  describe('getSpendSummary', () => {
    it('aggregates cost and tokens grouped by scope for a given org', async () => {
      const summary = [
        { scope: 'chat', _sum: { costUsd: 0.05, inputTokens: 300, outputTokens: 150 } },
      ];
      mockSpendLog.groupBy.mockResolvedValue(summary);

      const result = await repository.getSpendSummary('org1');

      expect(mockSpendLog.groupBy).toHaveBeenCalledWith({
        by: ['scope'],
        where: { organizationId: 'org1' },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      });
      expect(result).toEqual(summary);
    });

    it('falls back to empty where when orgId is undefined', async () => {
      await repository.getSpendSummary(undefined);

      expect(mockSpendLog.groupBy).toHaveBeenCalledWith({
        by: ['scope'],
        where: {},
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      });
    });
  });

  // ── AISettingsAudit ──

  describe('getAuditLogs', () => {
    it('returns paginated audit logs with defaults', async () => {
      await repository.getAuditLogs();

      expect(mockAudit.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 100,
        skip: 0,
      });
    });

    it('respects custom limit and offset', async () => {
      await repository.getAuditLogs(20, 10);

      expect(mockAudit.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 10,
      });
    });
  });

  describe('createAuditLog', () => {
    it('creates an audit entry', async () => {
      const data = {
        userId: 'u1',
        action: 'provider.upsert',
        detail: '{"identifier":"openai"}',
      };
      const created = { id: 'a1', ...data };
      mockAudit.create.mockResolvedValue(created);

      const result = await repository.createAuditLog(data);

      expect(mockAudit.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });

    it('creates entry with optional fields omitted', async () => {
      await repository.createAuditLog({ action: 'config.delete' });

      expect(mockAudit.create).toHaveBeenCalledWith({
        data: { action: 'config.delete' },
      });
    });
  });

  // ── AIBrandProfile ──

  describe('getBrandProfile', () => {
    it('fetches default brand for org', async () => {
      const profile = { organizationId: 'org1', instructions: 'Be concise', isDefault: true };
      mockBrandProfile.findFirst.mockResolvedValue(profile);

      const result = await repository.getBrandProfile('org1');

      expect(mockBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org1', isDefault: true },
      });
      expect(result).toEqual(profile);
    });

    it('fetches specific brand when brandId is provided', async () => {
      const profile = { id: 'brand-2', organizationId: 'org1', instructions: 'Be funny', isDefault: false };
      mockBrandProfile.findFirst.mockResolvedValue(profile);

      const result = await repository.getBrandProfile('org1', 'brand-2');

      expect(mockBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'brand-2', organizationId: 'org1' },
      });
      expect(result).toEqual(profile);
    });

    it('returns null when none exists', async () => {
      mockBrandProfile.findFirst.mockResolvedValue(null);
      expect(await repository.getBrandProfile('unknown')).toBeNull();
    });
  });

  describe('upsertBrandProfile', () => {
    it('updates existing default brand scoped by org', async () => {
      const existing = { id: 'brand-1', organizationId: 'org1', name: 'Default' };
      mockBrandProfile.findFirst.mockResolvedValue(existing);
      mockBrandProfile.updateMany.mockResolvedValue({ count: 1 });

      const data = { instructions: 'Be helpful', language: 'en', enabled: true };
      const result = await repository.upsertBrandProfile('org1', data);

      expect(mockBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org1', isDefault: true },
      });
      expect(mockBrandProfile.updateMany).toHaveBeenCalledWith({
        where: { id: 'brand-1', organizationId: 'org1' },
        data,
      });
      expect(result.instructions).toBe('Be helpful');
    });

    it('creates new brand when no default exists', async () => {
      mockBrandProfile.findFirst.mockResolvedValue(null);
      const created = { id: 'brand-new', organizationId: 'org1', name: 'Default Brand', isDefault: true };
      mockBrandProfile.create.mockResolvedValue(created);

      const data = { instructions: 'Be concise', language: 'en', enabled: true };
      const result = await repository.upsertBrandProfile('org1', data);

      expect(mockBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org1', isDefault: true },
      });
      expect(mockBrandProfile.create).toHaveBeenCalledWith({
        data: { organizationId: 'org1', ...data, isDefault: true, name: 'Default Brand' },
      });
      expect(result).toEqual(created);
    });
  });

  // ── AIPromptTemplate ──

  describe('getPromptTemplates', () => {
    it('filters to a specific org when organizationId is a string', async () => {
      await repository.getPromptTemplates('org1');

      expect(mockPromptTemplate.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
      });
    });

    it('filters to global (null) when organizationId is null', async () => {
      await repository.getPromptTemplates(null);

      expect(mockPromptTemplate.findMany).toHaveBeenCalledWith({
        where: { organizationId: null },
      });
    });

    it('applies no filter when organizationId is undefined', async () => {
      await repository.getPromptTemplates(undefined);

      expect(mockPromptTemplate.findMany).toHaveBeenCalledWith({ where: {} });
    });
  });

  describe('getPromptTemplatesForResolution', () => {
    it('fetches templates for org OR global (null)', async () => {
      await repository.getPromptTemplatesForResolution('org1');

      expect(mockPromptTemplate.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { organizationId: 'org1' },
            { organizationId: null },
          ],
        },
      });
    });
  });

  describe('getPromptTemplate', () => {
    it('fetches by composite key (organizationId, key)', async () => {
      const template = { organizationId: 'org1', key: 'greeting', content: 'Hello' };
      mockPromptTemplate.findUnique.mockResolvedValue(template);

      const result = await repository.getPromptTemplate('org1', 'greeting');

      expect(mockPromptTemplate.findUnique).toHaveBeenCalledWith({
        where: { organizationId_key: { organizationId: 'org1', key: 'greeting' } },
      });
      expect(result).toEqual(template);
    });

    it('fetches global templates by globalKey', async () => {
      const template = { organizationId: null, globalKey: 'system', key: 'system', content: 'System' };
      mockPromptTemplate.findUnique.mockResolvedValue(template);

      const result = await repository.getPromptTemplate(null, 'system');

      expect(mockPromptTemplate.findUnique).toHaveBeenCalledWith({
        where: { globalKey: 'system' },
      });
      expect(result).toEqual(template);
    });
  });

  describe('upsertPromptTemplate', () => {
    it('upserts by composite key, updating only content', async () => {
      const upserted = { organizationId: 'org1', key: 'greeting', content: 'Hi' };
      mockPromptTemplate.upsert.mockResolvedValue(upserted);

      const result = await repository.upsertPromptTemplate('org1', 'greeting', 'Hi');

      expect(mockPromptTemplate.upsert).toHaveBeenCalledWith({
        where: { organizationId_key: { organizationId: 'org1', key: 'greeting' } },
        create: { organizationId: 'org1', globalKey: null, key: 'greeting', content: 'Hi' },
        update: { content: 'Hi', globalKey: null },
      });
      expect(result).toEqual(upserted);
    });

    it('handles null organizationId (global template)', async () => {
      await repository.upsertPromptTemplate(null, 'system', 'System prompt');

      expect(mockPromptTemplate.upsert).toHaveBeenCalledWith({
        where: { globalKey: 'system' },
        create: { organizationId: null, globalKey: 'system', key: 'system', content: 'System prompt' },
        update: { content: 'System prompt', globalKey: 'system' },
      });
    });
  });

  describe('deletePromptTemplate', () => {
    it('deletes by composite key', async () => {
      const deleted = { organizationId: 'org1', key: 'greeting', content: 'Hello' };
      mockPromptTemplate.delete.mockResolvedValue(deleted);

      const result = await repository.deletePromptTemplate('org1', 'greeting');

      expect(mockPromptTemplate.delete).toHaveBeenCalledWith({
        where: { organizationId_key: { organizationId: 'org1', key: 'greeting' } },
      });
      expect(result).toEqual(deleted);
    });

    it('deletes global templates by globalKey', async () => {
      const deleted = { organizationId: null, globalKey: 'system', key: 'system', content: 'Hello' };
      mockPromptTemplate.delete.mockResolvedValue(deleted);

      const result = await repository.deletePromptTemplate(null, 'system');

      expect(mockPromptTemplate.delete).toHaveBeenCalledWith({
        where: { globalKey: 'system' },
      });
      expect(result).toEqual(deleted);
    });
  });

  // ── AIMediaJob ──

  describe('createMediaJob', () => {
    it('creates a media job with all fields', async () => {
      const data = {
        organizationId: 'org1',
        userId: 'u1',
        provider: 'openai',
        operation: 'generate_image',
        status: 'pending',
        artifactUrl: 'https://cdn.example.com/img.png',
        provenance: 'dalle-3',
        costUsd: 0.02,
        creditType: 'image',
        error: undefined,
      };
      const created = { id: 'mj1', ...data };
      mockMediaJob.create.mockResolvedValue(created);

      const result = await repository.createMediaJob(data);

      expect(mockMediaJob.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });

    it('persists new Replicate columns (folderId, model, version, inputJson, operation image)', async () => {
      const data = {
        organizationId: 'org1',
        provider: 'replicate',
        operation: 'image',
        status: 'pending',
        folderId: 'folder-1',
        model: 'black-forest-labs/flux-schnell',
        version: 'v1',
        inputJson: JSON.stringify({ prompt: 'cat' }),
      };
      const created = { id: 'mj2', ...data };
      mockMediaJob.create.mockResolvedValue(created);

      const result = await repository.createMediaJob(data);

      expect(mockMediaJob.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });
  });

  describe('updateMediaJob', () => {
    it('updates a media job scoped by org', async () => {
      const updated = { id: 'mj1', status: 'completed', artifactUrl: 'https://cdn.example.com/img.png' };
      mockMediaJob.update.mockResolvedValue(updated);

      const result = await repository.updateMediaJob('org-1', 'mj1', {
        status: 'completed',
        artifactUrl: 'https://cdn.example.com/img.png',
      });

      expect(mockMediaJob.update).toHaveBeenCalledWith({
        where: { id: 'mj1', organizationId: 'org-1' },
        data: { status: 'completed', artifactUrl: 'https://cdn.example.com/img.png' },
      });
      expect(result).toEqual(updated);
    });
  });

  describe('claimMediaJobStatus (§3.1)', () => {
    it('conditionally transitions status scoped by org and returns the updated count', async () => {
      mockMediaJob.updateMany.mockResolvedValue({ count: 1 });

      const count = await repository.claimMediaJobStatus('org-1', 'mj1', ['pending', 'processing'], 'landing');

      expect(mockMediaJob.updateMany).toHaveBeenCalledWith({
        where: { id: 'mj1', organizationId: 'org-1', status: { in: ['pending', 'processing'] } },
        data: { status: 'landing' },
      });
      expect(count).toBe(1);
    });

    it('returns 0 when the row is no longer in an eligible status (lost claim)', async () => {
      mockMediaJob.updateMany.mockResolvedValue({ count: 0 });
      expect(await repository.claimMediaJobStatus('org-1', 'mj1', ['pending'], 'processing')).toBe(0);
    });
  });

  describe('reclaimStaleLandingJobs (§3.1 crash-recovery)', () => {
    it('resets only `landing` rows older than the cutoff back to `processing`', async () => {
      mockMediaJob.updateMany.mockResolvedValue({ count: 2 });
      const cutoff = new Date('2026-07-05T00:00:00.000Z');

      const count = await repository.reclaimStaleLandingJobs(cutoff);

      expect(mockMediaJob.updateMany).toHaveBeenCalledWith({
        where: { status: 'landing', updatedAt: { lt: cutoff } },
        data: { status: 'processing' },
      });
      expect(count).toBe(2);
    });
  });

  describe('getPendingMediaJobs (fair sweep §6.2)', () => {
    it('over-fetches oldest-first (limit*3) and passes through when the pool fits', async () => {
      mockMediaJob.findMany.mockResolvedValue([{ id: 'a', organizationId: 'o1' }]);

      const result = await repository.getPendingMediaJobs(10);

      expect(mockMediaJob.findMany).toHaveBeenCalledWith({
        where: { status: { in: ['pending', 'processing'] } },
        orderBy: { createdAt: 'asc' },
        take: 30,
      });
      expect(result).toHaveLength(1);
    });

    it('caps a flooding org so other orgs are not starved from the window', async () => {
      const pool = [
        ...Array.from({ length: 25 }, (_, i) => ({ id: `a${i}`, organizationId: 'orgA' })),
        ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, organizationId: 'orgB' })),
        ...Array.from({ length: 2 }, (_, i) => ({ id: `c${i}`, organizationId: 'orgC' })),
      ];
      mockMediaJob.findMany.mockResolvedValue(pool);

      const selected = await repository.getPendingMediaJobs(10);
      const countOf = (org: string) => selected.filter((j: any) => j.organizationId === org).length;

      expect(selected).toHaveLength(10);
      // per-org cap = ceil(10/5) = 2 → orgB and orgC get in despite orgA flooding the head;
      // the leftover pass fills the remaining slots from orgA's overflow.
      expect(countOf('orgB')).toBe(2);
      expect(countOf('orgC')).toBe(2);
      expect(countOf('orgA')).toBe(6);
    });
  });

  describe('getMediaJobs', () => {
    it('fetches media jobs for an organization with default limit', async () => {
      await repository.getMediaJobs('org1');

      expect(mockMediaJob.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('respects custom limit', async () => {
      await repository.getMediaJobs('org1', 10);

      expect(mockMediaJob.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });

  describe('countInFlightVideoExports (F4)', () => {
    it('counts non-terminal video_export jobs in the window, excluding stale processing rows', async () => {
      mockMediaJob.count.mockResolvedValue(3);
      const from = new Date('2026-07-01T00:00:00.000Z');

      const result = await repository.countInFlightVideoExports('org-1', from);

      expect(result).toBe(3);
      const where = mockMediaJob.count.mock.calls[0][0].where;
      expect(where.organizationId).toBe('org-1');
      expect(where.creditType).toBe('video_export');
      expect(where.createdAt).toEqual({ gte: from });
      // Non-terminal rows (pending/landing/…) count in full...
      expect(where.OR).toHaveLength(2);
      expect(where.OR[0]).toEqual({
        status: { notIn: ['completed', 'failed', 'processing'] },
      });
      // ...but a `processing` row only counts while it is fresh — a row stale
      // past the job timeout was stranded by a crash and must not hold a slot.
      expect(where.OR[1].status).toBe('processing');
      expect(where.OR[1].updatedAt.gte).toBeInstanceOf(Date);
      expect(where.OR[1].updatedAt.gte.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  // ── AIPromptLibraryItem ──

  describe('getPromptLibraryItems', () => {
    it('fetches library items ordered by createdAt desc', async () => {
      const items = [{ id: '1', organizationId: 'org1', title: 'My Prompt', content: '...' }];
      mockPromptLibraryItem.findMany.mockResolvedValue(items);

      const result = await repository.getPromptLibraryItems('org1');

      expect(mockPromptLibraryItem.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(items);
    });

    it('returns empty when no items exist', async () => {
      mockPromptLibraryItem.findMany.mockResolvedValue([]);
      const result = await repository.getPromptLibraryItems('org1');
      expect(result).toEqual([]);
    });
  });

  describe('createPromptLibraryItem', () => {
    it('creates an item', async () => {
      const data = { organizationId: 'org1', title: 'My Prompt', content: 'Act as...' };
      const created = { id: 'li1', ...data };
      mockPromptLibraryItem.create.mockResolvedValue(created);

      const result = await repository.createPromptLibraryItem(data);

      expect(mockPromptLibraryItem.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });
  });

  describe('deletePromptLibraryItem', () => {
    it('deletes scoped by id and organizationId', async () => {
      mockPromptLibraryItem.deleteMany.mockResolvedValue({ count: 1 });

      const result = await repository.deletePromptLibraryItem('li1', 'org1');

      expect(mockPromptLibraryItem.deleteMany).toHaveBeenCalledWith({
        where: { id: 'li1', organizationId: 'org1' },
      });
      expect(result).toEqual({ count: 1 });
    });

    it('returns count 0 when item does not belong to the org', async () => {
      mockPromptLibraryItem.deleteMany.mockResolvedValue({ count: 0 });

      const result = await repository.deletePromptLibraryItem('li1', 'org1');

      expect(result).toEqual({ count: 0 });
    });
  });

  // ── AIContentIndex ──

  describe('getContentIndexEntries', () => {
    it('fetches by org + sourceType + sourceId', async () => {
      const rows = [{ organizationId: 'org1', sourceType: 'file', sourceId: 'doc1', chunkIndex: 0 }];
      mockContentIndex.findMany.mockResolvedValue(rows);

      const result = await repository.getContentIndexEntries('org1', 'file', 'doc1');

      expect(mockContentIndex.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', sourceType: 'file', sourceId: 'doc1' },
      });
      expect(result).toEqual(rows);
    });
  });

  describe('createContentIndex', () => {
    it('creates a content index entry', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'file',
        sourceId: 'doc1',
        chunkIndex: 0,
        contentHash: 'abc12345',
        chunk: 'Hello world',
      };
      const created = { id: 'ci1', ...data };
      mockContentIndex.create.mockResolvedValue(created);

      const result = await repository.createContentIndex(data);

      expect(mockContentIndex.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });
  });

  describe('deleteContentIndexEntries', () => {
    it('deleteMany by org + sourceType + sourceId', async () => {
      mockContentIndex.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repository.deleteContentIndexEntries('org1', 'file', 'doc1');

      expect(mockContentIndex.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1', sourceType: 'file', sourceId: 'doc1' },
      });
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('upsertContentIndex', () => {
    it('upserts by composite unique key', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'file',
        sourceId: 'doc1',
        chunkIndex: 2,
        contentHash: 'def67890',
        chunk: 'Some content',
      };
      const upserted = { id: 'ci2', ...data };
      mockContentIndex.upsert.mockResolvedValue(upserted);

      const result = await repository.upsertContentIndex(data);

      expect(mockContentIndex.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_sourceType_sourceId_chunkIndex: {
            organizationId: 'org1',
            sourceType: 'file',
            sourceId: 'doc1',
            chunkIndex: 2,
          },
        },
        create: data,
        update: { contentHash: 'def67890', chunk: 'Some content' },
      });
      expect(result).toEqual(upserted);
    });

    it('does not include key fields in the update payload', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'page',
        sourceId: 'p1',
        chunkIndex: 0,
        contentHash: 'aaa11111',
      };

      await repository.upsertContentIndex(data);

      const call = mockContentIndex.upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('organizationId');
      expect(call.update).not.toHaveProperty('sourceType');
      expect(call.update).not.toHaveProperty('sourceId');
      expect(call.update).not.toHaveProperty('chunkIndex');
      expect(call.update).toEqual({ contentHash: 'aaa11111' });
    });
  });

  // ── AIOrgProviderConfig ──

  describe('getOrgProviderConfigs', () => {
    it('fetches configs for an organization', async () => {
      const configs = [
        { id: '1', organizationId: 'org1', identifier: 'openai', enabled: true },
      ];
      mockOrgProviderConfig.findMany.mockResolvedValue(configs);

      const result = await repository.getOrgProviderConfigs('org1');

      expect(mockOrgProviderConfig.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
      });
      expect(result).toEqual(configs);
    });

    it('returns empty when org has no configs', async () => {
      mockOrgProviderConfig.findMany.mockResolvedValue([]);
      const result = await repository.getOrgProviderConfigs('org1');
      expect(result).toEqual([]);
    });
  });

  describe('getOrgProviderConfig', () => {
    it('fetches by composite key', async () => {
      const config = { organizationId: 'org1', identifier: 'openai', enabled: true };
      mockOrgProviderConfig.findUnique.mockResolvedValue(config);

      const result = await repository.getOrgProviderConfig('org1', 'openai');

      expect(mockOrgProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v1' } },
      });
      expect(result).toEqual(config);
    });

    it('returns null when not found', async () => {
      mockOrgProviderConfig.findUnique.mockResolvedValue(null);
      expect(await repository.getOrgProviderConfig('org1', 'unknown')).toBeNull();
    });
  });

  describe('upsertOrgProviderConfig', () => {
    it('upserts by composite key', async () => {
      const data = { enabled: true, credentials: 'enc', defaultModel: 'gpt-4' };
      const upserted = { id: '1', organizationId: 'org1', identifier: 'openai', ...data };
      mockOrgProviderConfig.upsert.mockResolvedValue(upserted);

      const result = await repository.upsertOrgProviderConfig('org1', 'openai', data);

      expect(mockOrgProviderConfig.upsert).toHaveBeenCalledWith({
        where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v1' } },
        create: { organizationId: 'org1', identifier: 'openai', version: 'v1', ...data },
        update: data,
      });
      expect(result).toEqual(upserted);
    });
  });

  describe('deleteOrgProviderConfig', () => {
    it('deletes by composite key', async () => {
      const deleted = { organizationId: 'org1', identifier: 'openai' };
      mockOrgProviderConfig.delete.mockResolvedValue(deleted);

      const result = await repository.deleteOrgProviderConfig('org1', 'openai');

      expect(mockOrgProviderConfig.delete).toHaveBeenCalledWith({
        where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v1' } },
      });
      expect(result).toEqual(deleted);
    });
  });
});
