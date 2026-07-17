import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackfillService } from './backfill.service';

type Tx = {
  user: { findMany: ReturnType<typeof vi.fn> };
  userProfile: { create: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  notificationPreference: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  appRole: { findMany: ReturnType<typeof vi.fn> };
  userOrganization: {
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  aIBrandProfile: { updateMany: ReturnType<typeof vi.fn> };
  storageProviderConfig: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  orgShortLinkConfig: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  aISystemSettings: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  aIOrgProviderConfig: { findMany: ReturnType<typeof vi.fn> };
  mediaProviderConfig: { upsert: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
};

const makeTx = (): Tx => ({
  user: { findMany: vi.fn().mockResolvedValue([]) },
  userProfile: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  notificationPreference: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
  },
  appRole: { findMany: vi.fn().mockResolvedValue([]) },
  userOrganization: {
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
  aIBrandProfile: { updateMany: vi.fn() },
  storageProviderConfig: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  orgShortLinkConfig: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  aISystemSettings: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
  },
  aIOrgProviderConfig: { findMany: vi.fn().mockResolvedValue([]) },
  mediaProviderConfig: { upsert: vi.fn() },
  // the budget cleanup takes a SELECT … FOR UPDATE row lock
  $executeRaw: vi.fn().mockResolvedValue(0),
});

const makeService = (tx: Tx) => {
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: Tx) => Promise<void>) => fn(tx)),
  };
  // The service only touches prisma.$transaction; the tx shape above covers
  // every model the backfill reads/writes.
  return new BackfillService(prisma as never);
};

describe('BackfillService — ragSettings.mediaProviders migration', () => {
  let tx: Tx;

  beforeEach(() => {
    tx = makeTx();
  });

  it('migrates blob entries to MediaProviderConfig and strips the blob key', async () => {
    tx.aISystemSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      ragSettings: JSON.stringify({
        someRagKey: { keep: true },
        mediaProviders: {
          openai: { enabled: true, operations: ['image'], c2paAvailable: false },
        },
      }),
    });
    tx.aIOrgProviderConfig.findMany.mockResolvedValue([
      { organizationId: 'org-1' },
    ]);

    await makeService(tx).backfill();

    expect(tx.mediaProviderConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_identifier_version: {
            organizationId: 'org-1',
            identifier: 'openai',
            version: 'v1',
          },
        },
        create: expect.objectContaining({ enabled: true }),
      })
    );

    // Step 7: the blob key is removed, other rag settings are preserved.
    expect(tx.aISystemSettings.update).toHaveBeenCalledTimes(1);
    const updateArg = tx.aISystemSettings.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'settings-1' });
    const rewritten = JSON.parse(updateArg.data.ragSettings);
    expect(rewritten.mediaProviders).toBeUndefined();
    expect(rewritten.someRagKey).toEqual({ keep: true });
  });

  it('is a no-op when the blob key is absent (idempotent after the strip)', async () => {
    tx.aISystemSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      ragSettings: JSON.stringify({ someRagKey: { keep: true } }),
    });

    await makeService(tx).backfill();

    expect(tx.mediaProviderConfig.upsert).not.toHaveBeenCalled();
    expect(tx.aISystemSettings.update).not.toHaveBeenCalled();
  });

  it('is a no-op when there are no AI system settings', async () => {
    await makeService(tx).backfill();
    expect(tx.mediaProviderConfig.upsert).not.toHaveBeenCalled();
    expect(tx.aISystemSettings.update).not.toHaveBeenCalled();
  });

  it('ignores unparseable ragSettings without touching the row', async () => {
    tx.aISystemSettings.findFirst.mockResolvedValue({
      id: 'settings-1',
      ragSettings: 'not-json',
    });

    await makeService(tx).backfill();

    expect(tx.mediaProviderConfig.upsert).not.toHaveBeenCalled();
    expect(tx.aISystemSettings.update).not.toHaveBeenCalled();
  });
});

describe('BackfillService — budget global-cap cleanup (0.4)', () => {
  let tx: Tx;
  beforeEach(() => {
    tx = makeTx();
  });

  const runCleanup = (service: BackfillService) =>
    (service as any).cleanupLeakedGlobalBudgetCaps(tx);

  it('strips leaked top-level caps while preserving perOrgCaps', async () => {
    tx.aISystemSettings.findUnique.mockResolvedValue({
      budgetSettings: JSON.stringify({
        monthlyCap: 1000,
        dailyCap: 50,
        alertThresholdPct: 0.8,
        perOrgCaps: { orgA: { monthly: 5 }, orgB: { daily: 2 } },
        scopeCaps: { agent: { monthly: 3 } },
      }),
    });

    await runCleanup(makeService(tx));

    expect(tx.aISystemSettings.update).toHaveBeenCalledTimes(1);
    const written = JSON.parse(
      tx.aISystemSettings.update.mock.calls[0][0].data.budgetSettings,
    );
    // top-level org-slice keys that leaked upward are gone…
    expect(written).not.toHaveProperty('monthlyCap');
    expect(written).not.toHaveProperty('dailyCap');
    expect(written).not.toHaveProperty('alertThresholdPct');
    // …perOrgCaps (and other keys) intact.
    expect(written.perOrgCaps).toEqual({ orgA: { monthly: 5 }, orgB: { daily: 2 } });
    expect(written.scopeCaps).toEqual({ agent: { monthly: 3 } });
    // …and the stripped values are preserved (an intentional super-admin global
    // cap is indistinguishable from a leak — never destroy silently).
    expect(written._strippedLegacyGlobalCaps).toEqual({
      monthlyCap: 1000,
      dailyCap: 50,
      alertThresholdPct: 0.8,
    });
  });

  it('is a no-op when there are no leaked top-level caps', async () => {
    tx.aISystemSettings.findUnique.mockResolvedValue({
      budgetSettings: JSON.stringify({ perOrgCaps: { orgA: { monthly: 5 } } }),
    });
    await runCleanup(makeService(tx));
    expect(tx.aISystemSettings.update).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no settings row / no budgetSettings', async () => {
    tx.aISystemSettings.findUnique.mockResolvedValue(null);
    await runCleanup(makeService(tx));
    expect(tx.aISystemSettings.update).not.toHaveBeenCalled();
  });
});

describe('BackfillService — notifications V2 email opt-out carry-forward', () => {
  let tx: Tx;

  beforeEach(() => {
    tx = makeTx();
  });

  it('copies each UserProfile email opt-OUT into a new NotificationPreference', async () => {
    tx.userProfile.findMany.mockResolvedValue([
      {
        userId: 'user-1',
        sendSuccessEmails: false,
        sendFailureEmails: true,
        sendStreakEmails: false,
      },
    ]);

    await makeService(tx).backfill();

    expect(tx.notificationPreference.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        categories: {
          post_published: { email: false },
          streak: { email: false },
        },
      },
    });
    // opted-in category (failure) is not carried — defaults are opt-in already.
    const created = tx.notificationPreference.create.mock.calls[0][0];
    expect(created.data.categories.post_failed).toBeUndefined();
  });

  it('does not clobber a value already set under the new key (post-deploy save wins)', async () => {
    tx.userProfile.findMany.mockResolvedValue([
      { userId: 'user-1', sendSuccessEmails: false, sendFailureEmails: true, sendStreakEmails: true },
    ]);
    tx.notificationPreference.findUnique.mockResolvedValue({
      userId: 'user-1',
      categories: { post_published: { email: true, inApp: true } },
    });

    await makeService(tx).backfill();

    expect(tx.notificationPreference.create).not.toHaveBeenCalled();
    expect(tx.notificationPreference.update).not.toHaveBeenCalled();
  });

  it('is a no-op when no profile has an opt-out', async () => {
    tx.userProfile.findMany.mockResolvedValue([]);

    await makeService(tx).backfill();

    expect(tx.notificationPreference.create).not.toHaveBeenCalled();
    expect(tx.notificationPreference.update).not.toHaveBeenCalled();
  });
});

describe('BackfillService — AI/media default models', () => {
  let tx: Tx;
  const mockSeedUnset = vi.fn();
  const mockWasApplied = vi.fn().mockResolvedValue(false);
  const mockMarkApplied = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    tx = makeTx();
    mockSeedUnset.mockReset();
    mockWasApplied.mockReset().mockResolvedValue(false);
    mockMarkApplied.mockReset().mockResolvedValue(undefined);
  });

  function makeServiceWithSeed() {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: Tx) => Promise<void>) => fn(tx)),
      organization: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'org-1' },
          { id: 'org-2' },
        ]),
      },
    };
    const ledger = {
      wasApplied: mockWasApplied,
      markApplied: mockMarkApplied,
    };
    const seedService = {
      seedUnset: mockSeedUnset,
      seedAllOrgs: vi.fn(),
    };
    return new BackfillService(prisma as never, ledger as never, seedService as never);
  }

  it('calls seedUnset for every org with an enabled provider', async () => {
    await makeServiceWithSeed().backfill();

    expect(mockSeedUnset).toHaveBeenCalledTimes(2);
    expect(mockSeedUnset).toHaveBeenCalledWith('org-1');
    expect(mockSeedUnset).toHaveBeenCalledWith('org-2');
  });

  it('is idempotent via the migration ledger', async () => {
    mockWasApplied.mockResolvedValue(true);

    await makeServiceWithSeed().backfill();

    expect(mockSeedUnset).not.toHaveBeenCalled();
  });

  it('marks the step applied after success', async () => {
    await makeServiceWithSeed().backfill();

    expect(mockMarkApplied).toHaveBeenCalledWith('backfill:AI/media default models');
  });
});
