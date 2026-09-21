import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function () {
    return { model: {} };
  }),
}));

import { PrismaRepository } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';
import { OrgAiSettingsRepository } from './org-ai-settings.repository';

describe('OrgAiSettingsRepository', () => {
  let repository: OrgAiSettingsRepository;
  let providerConfig: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    providerConfig = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    };
    const pc = new (PrismaRepository as any)();
    pc.model = { aIOrgProviderConfig: providerConfig };
    repository = new OrgAiSettingsRepository(pc);
  });

  it('getByOrg scopes by organization', () => {
    repository.getByOrg('org1');
    expect(providerConfig.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
    });
  });

  it('getByIdentifier uses default version v1', () => {
    repository.getByIdentifier('org1', 'openai');
    expect(providerConfig.findUnique).toHaveBeenCalledWith({
      where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v1' } },
    });
  });

  it('getByIdentifier honors an explicit version', () => {
    repository.getByIdentifier('org1', 'openai', 'v2');
    expect(providerConfig.findUnique).toHaveBeenCalledWith({
      where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v2' } },
    });
  });

  it('getActive filters on isActive', () => {
    repository.getActive('org1');
    expect(providerConfig.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org1', isActive: true },
    });
  });

  // 1.2: the version-agnostic read must NOT pin a version (getByIdentifier's
  // findUnique defaults to v1 and misses a v2-pinned row) — findFirst with no
  // version in the where, enabled rows first, then newest.
  it('findAnyByIdentifier reads version-agnostically, enabled-first', () => {
    repository.findAnyByIdentifier('org1', 'openai');
    expect(providerConfig.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org1', identifier: 'openai' },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('upsert builds create/update payloads with default version', () => {
    repository.upsert('org1', 'openai', { enabled: true, credentials: 'enc' });
    const arg = (providerConfig.upsert as any).mock.calls[0][0];
    expect(arg.where.organizationId_identifier_version.version).toBe('v1');
    expect(arg.create).toMatchObject({ organizationId: 'org1', identifier: 'openai', version: 'v1', enabled: true });
    expect(arg.update).toMatchObject({ enabled: true, credentials: 'enc' });
  });

  it('upsert passes provider budget columns through to create and update', () => {
    repository.upsert('org1', 'openai', {
      budgetMonthlyCap: 100,
      budgetDailyCap: 10,
      budgetAlertThresholdPct: 0.85,
    });
    const arg = (providerConfig.upsert as any).mock.calls[0][0];
    expect(arg.create).toMatchObject({
      budgetMonthlyCap: 100,
      budgetDailyCap: 10,
      budgetAlertThresholdPct: 0.85,
    });
    expect(arg.update).toMatchObject({
      budgetMonthlyCap: 100,
      budgetDailyCap: 10,
      budgetAlertThresholdPct: 0.85,
    });
  });

  it('delete uses default version', () => {
    repository.delete('org1', 'openai');
    expect(providerConfig.delete).toHaveBeenCalledWith({
      where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v1' } },
    });
  });

  it('setActive clears prior actives then activates the target', async () => {
    await repository.setActive('org1', 'openai', 'v2');
    expect(providerConfig.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', isActive: true },
      data: { isActive: false },
    });
    expect(providerConfig.update).toHaveBeenCalledWith({
      where: { organizationId_identifier_version: { organizationId: 'org1', identifier: 'openai', version: 'v2' } },
      data: { isActive: true, enabled: true },
    });
  });

  // 0.3: budget caps are per-org, scoped under budgetSettings.perOrgCaps[orgId].
});
