import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { BackfillService } from './backfill.service';
import { AuthService } from '@postmill-ai/helpers/auth/auth.service';

type Tx = {
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
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  aIOrgProviderConfig: { findMany: ReturnType<typeof vi.fn> };
  mediaProviderConfig: { upsert: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  // legacy secret re-encryption targets not already listed above
  // (findMany returns [] = nothing to rewrite)
  integration: { findMany: ReturnType<typeof vi.fn> };
  orgProviderConfiguration: { findMany: ReturnType<typeof vi.fn> };
  contentPackConfig: { findMany: ReturnType<typeof vi.fn> };
  orgVpnConfig: { findMany: ReturnType<typeof vi.fn> };
  authProviderConfig: { findMany: ReturnType<typeof vi.fn> };
  usedCodes: { findMany: ReturnType<typeof vi.fn> };
};

const makeTx = (): Tx => ({
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
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
  aIOrgProviderConfig: { findMany: vi.fn().mockResolvedValue([]) },
  mediaProviderConfig: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  integration: { findMany: vi.fn().mockResolvedValue([]) },
  orgProviderConfiguration: { findMany: vi.fn().mockResolvedValue([]) },
  contentPackConfig: { findMany: vi.fn().mockResolvedValue([]) },
  orgVpnConfig: { findMany: vi.fn().mockResolvedValue([]) },
  authProviderConfig: { findMany: vi.fn().mockResolvedValue([]) },
  usedCodes: { findMany: vi.fn().mockResolvedValue([]) },
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

describe('BackfillService — legacy secret re-encryption (v1.0.0 guard)', () => {
  // Real crypto on both sides: the fixture encrypts with the legacy CBC scheme
  // (EVP_BytesToKey md5/no-salt derivation, mirroring legacy-cbc.crypto.ts),
  // the step rewrites with the real AuthService.fixedEncryption (v2: GCM).
  const JWT_SECRET = 'test-jwt-secret-for-legacy-reencryption';

  function encryptLegacyCbc(plaintext: string): string {
    const pass = Buffer.from(JWT_SECRET, 'utf8');
    const blocks: Buffer[] = [];
    let prev = Buffer.alloc(0);
    let derived = 0;
    while (derived < 48) {
      const hash = crypto.createHash('md5');
      hash.update(prev);
      hash.update(pass);
      prev = hash.digest();
      blocks.push(prev);
      derived += prev.length;
    }
    const material = Buffer.concat(blocks);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      material.subarray(0, 32),
      material.subarray(32, 48),
    );
    return Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]).toString('hex');
  }

  const makeDelegate = (rows: Array<{ id: string; [k: string]: unknown }>) => ({
    findMany: vi.fn().mockResolvedValue(rows),
    update: vi.fn().mockResolvedValue({}),
  });

  // A tx carrying every delegate the step touches (all empty), overridable per test.
  const makeReencryptTx = (
    overrides: Record<string, ReturnType<typeof makeDelegate>> = {},
  ) => ({
    integration: makeDelegate([]),
    orgProviderConfiguration: makeDelegate([]),
    aIOrgProviderConfig: makeDelegate([]),
    aISystemSettings: makeDelegate([]),
    storageProviderConfig: makeDelegate([]),
    orgShortLinkConfig: makeDelegate([]),
    mediaProviderConfig: makeDelegate([]),
    contentPackConfig: makeDelegate([]),
    orgVpnConfig: makeDelegate([]),
    authProviderConfig: makeDelegate([]),
    usedCodes: makeDelegate([]),
    ...overrides,
  });

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
  });

  const runStep = (tx: Record<string, unknown>) => {
    const prisma = {
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
    };
    const service = new BackfillService(prisma as never);
    return (service as any).reencryptLegacySecrets(tx);
  };

  it('scans only non-v2:, non-empty values (v2: rows are filtered out in the query)', async () => {
    const delegate = makeDelegate([]);
    const tx = { integration: delegate };
    // Only the models present on the tx are exercised here; call the column
    // helper directly to assert the filter shape for one column.
    const service = new BackfillService({} as never);
    await (service as any)._reencryptColumn(tx, 'integration', 'token', true);

    const where = delegate.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      { token: { not: null } },
      { token: { not: '' } },
      { token: { not: { startsWith: 'v2:' } } },
    ]);
    expect(delegate.update).not.toHaveBeenCalled();
  });

  it('rewrites a legacy CBC ciphertext to v2: GCM', async () => {
    const delegate = makeDelegate([
      { id: 'int-1', token: encryptLegacyCbc('secret-token') },
    ]);
    await runStep(makeReencryptTx({ integration: delegate }));

    expect(delegate.update).toHaveBeenCalledTimes(1);
    const update = delegate.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'int-1' });
    expect(update.data.token.startsWith('v2:')).toBe(true);
    expect(AuthService.fixedDecryption(update.data.token)).toBe('secret-token');
  });

  it('treats an undecryptable Integration.token as legacy plaintext and encrypts it as-is', async () => {
    const delegate = makeDelegate([{ id: 'int-2', token: 'plain-raw-token' }]);
    await runStep(makeReencryptTx({ integration: delegate }));

    expect(delegate.update).toHaveBeenCalledTimes(1);
    const update = delegate.update.mock.calls[0][0];
    expect(AuthService.fixedDecryption(update.data.token)).toBe('plain-raw-token');
  });

  it('treats an undecryptable additionalConfig blob as legacy plaintext JSON', async () => {
    const blob = JSON.stringify({ botToken: 'discord-bot-token' });
    const delegate = makeDelegate([{ id: 'cfg-1', additionalConfig: blob }]);
    await runStep(makeReencryptTx({ orgProviderConfiguration: delegate }));

    expect(delegate.update).toHaveBeenCalledTimes(1);
    const update = delegate.update.mock.calls[0][0];
    expect(AuthService.fixedDecryption(update.data.additionalConfig)).toBe(blob);
  });

  it('leaves undecryptable values untouched on columns without a plaintext fallback', async () => {
    const delegate = makeDelegate([
      { id: 'spc-1', credentials: 'not-cbc-not-plaintext!!' },
    ]);
    await runStep(makeReencryptTx({ storageProviderConfig: delegate }));

    expect(delegate.update).not.toHaveBeenCalled();
  });

  it('is ledger-gated under the "backfill:legacy secret re-encryption" key', async () => {
    const tx = makeTx();
    const prisma = {
      $transaction: vi.fn(async (fn: (t: Tx) => Promise<void>) => fn(tx)),
    };
    const ledger = {
      wasApplied: vi.fn().mockResolvedValue(false),
      markApplied: vi.fn().mockResolvedValue(undefined),
    };
    await new BackfillService(prisma as never, ledger as never).backfill();
    expect(ledger.markApplied).toHaveBeenCalledWith(
      'backfill:legacy secret re-encryption',
    );
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
