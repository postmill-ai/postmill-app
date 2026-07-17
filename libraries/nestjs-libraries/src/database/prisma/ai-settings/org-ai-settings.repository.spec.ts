import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function () {
    return { model: {} };
  }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OrgAiSettingsRepository } from './org-ai-settings.repository';

describe('OrgAiSettingsRepository', () => {
  let repository: OrgAiSettingsRepository;
  let providerConfig: Record<string, ReturnType<typeof vi.fn>>;
  let systemSettings: Record<string, ReturnType<typeof vi.fn>>;

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
    systemSettings = {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    };
    const pc = new (PrismaRepository as any)();
    pc.model = { aIOrgProviderConfig: providerConfig };
    const ss = new (PrismaRepository as any)();
    ss.model = { aISystemSettings: systemSettings };
    // 3.7: upsertBudget now runs inside an interactive transaction with a row lock.
    // The transaction client (tx) exposes the SAME aISystemSettings mock so the
    // existing findUnique/upsert assertions still hold, plus a no-op $executeRaw
    // for the `SELECT … FOR UPDATE` lock.
    const transaction = {
      model: {
        $transaction: vi.fn(async (cb: any) =>
          cb({
            aISystemSettings: systemSettings,
            $executeRaw: vi.fn().mockResolvedValue(0),
          }),
        ),
      },
    };
    repository = new OrgAiSettingsRepository(pc, ss, transaction as any);
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
  describe('getBudget (0.3 per-org scoping)', () => {
    it("returns only this org's perOrgCaps slice (translated to DTO keys)", async () => {
      // stored slice uses BudgetService's keys (monthly/daily); read translates to monthlyCap/dailyCap
      systemSettings.findUnique.mockResolvedValue({
        budgetSettings: JSON.stringify({ perOrgCaps: { org1: { monthly: 50 }, org2: { monthly: 99 } } }),
      });
      expect(await repository.getBudget('org1')).toEqual({ monthlyCap: 50 });
    });

    it('never returns the whole blob or other orgs perOrgCaps', async () => {
      systemSettings.findUnique.mockResolvedValue({
        budgetSettings: JSON.stringify({
          monthlyCap: 1000,
          perOrgCaps: { org1: { monthly: 50 }, org2: { monthly: 99 } },
        }),
      });
      const result = await repository.getBudget('org1');
      expect(result).toEqual({ monthlyCap: 50 });
      expect(result).not.toHaveProperty('perOrgCaps');
    });

    it('returns null when this org has no slice', async () => {
      systemSettings.findUnique.mockResolvedValue({
        budgetSettings: JSON.stringify({ perOrgCaps: { org2: { monthly: 99 } } }),
      });
      expect(await repository.getBudget('org1')).toBeNull();
    });

    it('returns null when no settings row', async () => {
      systemSettings.findUnique.mockResolvedValue(null);
      expect(await repository.getBudget('org1')).toBeNull();
    });

    it('returns null when budgetSettings is empty', async () => {
      systemSettings.findUnique.mockResolvedValue({ budgetSettings: null });
      expect(await repository.getBudget('org1')).toBeNull();
    });

    it('returns null when budgetSettings is invalid JSON', async () => {
      systemSettings.findUnique.mockResolvedValue({ budgetSettings: '{not json' });
      expect(await repository.getBudget('org1')).toBeNull();
    });
  });

  describe('upsertBudget (0.3 per-org scoping + 3.10 parse guard)', () => {
    it("merges into this org's slice, preserving other orgs", async () => {
      systemSettings.findUnique.mockResolvedValue({
        budgetSettings: JSON.stringify({ perOrgCaps: { org1: { monthly: 50, daily: 5 }, org2: { monthly: 99 } } }),
      });
      await repository.upsertBudget('org1', { dailyCap: 10 });
      const arg = (systemSettings.upsert as any).mock.calls[0][0];
      const written = JSON.parse(arg.update.budgetSettings);
      // translated to BudgetService's keys (monthly/daily)
      expect(written.perOrgCaps.org1).toEqual({ monthly: 50, daily: 10 });
      expect(written.perOrgCaps.org2).toEqual({ monthly: 99 });
    });

    // Regression guard for the key-mismatch bug: the DTO uses monthlyCap/dailyCap
    // but BudgetService.checkBudget enforces perOrgCaps[org].monthly/.daily.
    it('stores under the keys BudgetService enforces (monthly/daily), and getBudget round-trips to DTO keys', async () => {
      systemSettings.findUnique.mockResolvedValue(null);
      await repository.upsertBudget('org1', { monthlyCap: 50, dailyCap: 5, alertThresholdPct: 80 });
      const arg = (systemSettings.upsert as any).mock.calls[0][0];
      const written = JSON.parse(arg.create.budgetSettings);
      expect(written.perOrgCaps.org1).toEqual({ monthly: 50, daily: 5, alertThresholdPct: 80 });
      // and read translates back to the client contract
      systemSettings.findUnique.mockResolvedValue({ budgetSettings: arg.create.budgetSettings });
      expect(await repository.getBudget('org1')).toEqual({ monthlyCap: 50, dailyCap: 5, alertThresholdPct: 80 });
    });

    it('does not alter another org slice when this org writes', async () => {
      systemSettings.findUnique.mockResolvedValue({
        budgetSettings: JSON.stringify({ perOrgCaps: { orgA: { daily: 5 } } }),
      });
      await repository.upsertBudget('orgB', { dailyCap: 0.01 });
      const arg = (systemSettings.upsert as any).mock.calls[0][0];
      const written = JSON.parse(arg.update.budgetSettings);
      expect(written.perOrgCaps.orgA).toEqual({ daily: 5 });
      expect(written.perOrgCaps.orgB).toEqual({ daily: 0.01 });
    });

    it('starts from empty when no prior settings', async () => {
      systemSettings.findUnique.mockResolvedValue(null);
      await repository.upsertBudget('org1', { monthlyCap: 99 });
      const arg = (systemSettings.upsert as any).mock.calls[0][0];
      expect(JSON.parse(arg.create.budgetSettings)).toEqual({ perOrgCaps: { org1: { monthly: 99 } } });
    });

    // 5.5 (review F1): an org-sent `enabled` must NOT be persisted — the slice is
    // org-writable but a super-admin can impose a cap into the same slice, so a
    // stored enabled:false would hand tenants a self-exemption switch.
    it('drops an org-sent enabled flag instead of persisting it', async () => {
      systemSettings.findUnique.mockResolvedValue(null);
      await repository.upsertBudget('org1', { monthlyCap: 50, enabled: false });
      const arg = (systemSettings.upsert as any).mock.calls[0][0];
      expect(JSON.parse(arg.create.budgetSettings)).toEqual({
        perOrgCaps: { org1: { monthly: 50 } },
      });
    });

    // 3.10: a corrupt/legacy blob must not throw — fall back to {} and still write.
    it('does not throw on a corrupt existing blob', async () => {
      systemSettings.findUnique.mockResolvedValue({ budgetSettings: '{corrupt' });
      await expect(repository.upsertBudget('org1', { monthlyCap: 42 })).resolves.toBeDefined();
      const arg = (systemSettings.upsert as any).mock.calls[0][0];
      expect(JSON.parse(arg.update.budgetSettings)).toEqual({ perOrgCaps: { org1: { monthly: 42 } } });
    });
  });
});
