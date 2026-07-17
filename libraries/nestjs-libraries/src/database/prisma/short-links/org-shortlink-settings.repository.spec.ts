import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgShortLinkSettingsRepository } from './org-shortlink-settings.repository';

function createMockPrismaRepo() {
  return {
    model: {
      orgShortLinkConfig: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      shortLink: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      shortLinkSnapshot: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockImplementation((args) => args),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  };
}

function createMockTransaction() {
  return {
    model: {
      $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.resolve(ops)),
    },
  };
}

describe('OrgShortLinkSettingsRepository', () => {
  let repo: OrgShortLinkSettingsRepository;
  let config: ReturnType<typeof createMockPrismaRepo>;
  let link: ReturnType<typeof createMockPrismaRepo>;
  let snapshot: ReturnType<typeof createMockPrismaRepo>;
  let transaction: ReturnType<typeof createMockTransaction>;

  const orgId = 'org-1';
  const identifier = 'bitly';

  beforeEach(() => {
    vi.clearAllMocks();
    config = createMockPrismaRepo();
    link = createMockPrismaRepo();
    snapshot = createMockPrismaRepo();
    transaction = createMockTransaction();
    repo = new OrgShortLinkSettingsRepository(
      config as any,
      link as any,
      snapshot as any,
      transaction as any,
    );
  });

  describe('getByOrg', () => {
    it('queries by organizationId', async () => {
      const mockData = [{ id: 'c1', organizationId: orgId, identifier: 'bitly' }];
      config.model.orgShortLinkConfig.findMany.mockResolvedValue(mockData);

      const result = await repo.getByOrg(orgId);

      expect(config.model.orgShortLinkConfig.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
      expect(result).toEqual(mockData);
    });
  });

  describe('getByIdentifier', () => {
    it('queries by compound key with orderBy', async () => {
      const mockData = { id: 'c1', organizationId: orgId, identifier };
      config.model.orgShortLinkConfig.findFirst.mockResolvedValue(mockData);

      const result = await repo.getByIdentifier(orgId, identifier);

      expect(config.model.orgShortLinkConfig.findFirst).toHaveBeenCalledWith({
        where: { organizationId: orgId, identifier },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockData);
    });
  });

  describe('getActive', () => {
    it('queries by orgId and isActive = true', async () => {
      const mockData = { id: 'c1', organizationId: orgId, identifier, isActive: true };
      config.model.orgShortLinkConfig.findFirst.mockResolvedValue(mockData);

      const result = await repo.getActive(orgId);

      expect(config.model.orgShortLinkConfig.findFirst).toHaveBeenCalledWith({
        where: { organizationId: orgId, isActive: true },
      });
      expect(result).toEqual(mockData);
    });
  });

  describe('upsert', () => {
    it('creates or updates a config entry', async () => {
      const data = { enabled: true, credentials: 'encrypted' };
      config.model.orgShortLinkConfig.findFirst.mockResolvedValue(null);
      config.model.orgShortLinkConfig.create.mockResolvedValue({ id: 'c1', ...data });

      await repo.upsert(orgId, identifier, data);

      expect(config.model.orgShortLinkConfig.findFirst).toHaveBeenCalledWith({
        where: { organizationId: orgId, identifier },
        orderBy: { createdAt: 'desc' },
      });
      expect(config.model.orgShortLinkConfig.create).toHaveBeenCalledWith({
        data: { organizationId: orgId, identifier, version: 'v1', ...data },
      });
    });

    it('updates existing entry when found scoped by org', async () => {
      const existing = { id: 'c1', organizationId: orgId, identifier };
      const data = { enabled: true, credentials: 'encrypted' };
      config.model.orgShortLinkConfig.findFirst.mockResolvedValue(existing);
      config.model.orgShortLinkConfig.update.mockResolvedValue({ ...existing, ...data });

      await repo.upsert(orgId, identifier, data);

      expect(config.model.orgShortLinkConfig.update).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: orgId },
        data,
      });
    });

    it('uses triple unique when accountFingerprint is provided', async () => {
      const data = { enabled: true, credentials: 'encrypted', accountFingerprint: 'fp-1' };
      config.model.orgShortLinkConfig.upsert.mockResolvedValue({ id: 'c1', ...data });

      await repo.upsert(orgId, identifier, data);

      expect(config.model.orgShortLinkConfig.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_identifier_version_accountFingerprint: {
            organizationId: orgId,
            identifier,
            version: 'v1',
            accountFingerprint: 'fp-1',
          },
        },
        create: { organizationId: orgId, identifier, version: 'v1', ...data },
        update: data,
      });
    });
  });

  describe('delete', () => {
    it('deletes by compound key', async () => {
      await repo.delete(orgId, identifier);

      expect(config.model.orgShortLinkConfig.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, identifier },
      });
    });
  });

  describe('deleteById', () => {
    it('deletes by id scoped to org', async () => {
      config.model.orgShortLinkConfig.delete.mockResolvedValue({ id: 'c1' });

      await repo.deleteById(orgId, 'c1');

      expect(config.model.orgShortLinkConfig.delete).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: orgId },
      });
    });
  });

  describe('setActive', () => {
    it('deactivates all active configs then activates the target', async () => {
      const mockConfig = { id: 'c1', organizationId: orgId, identifier };
      config.model.orgShortLinkConfig.findFirst.mockResolvedValue(mockConfig);
      config.model.orgShortLinkConfig.updateMany.mockResolvedValue({ count: 1 });
      config.model.orgShortLinkConfig.update.mockResolvedValue({ ...mockConfig, isActive: true });

      await repo.setActive(orgId, identifier);

      expect(config.model.orgShortLinkConfig.findFirst).toHaveBeenCalledWith({
        where: { organizationId: orgId, identifier },
        orderBy: { createdAt: 'desc' },
      });
      expect(config.model.orgShortLinkConfig.updateMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, isActive: true },
        data: { isActive: false },
      });
      expect(config.model.orgShortLinkConfig.update).toHaveBeenCalledWith({
        where: { id: 'c1', organizationId: orgId },
        data: { isActive: true, enabled: true },
      });
    });
  });

  describe('recordLink', () => {
    it('creates a ShortLink ledger entry', async () => {
      const data = {
        organizationId: orgId,
        provider: 'bitly',
        shortUrl: 'https://bit.ly/abc',
        originalUrl: 'https://example.com/long',
        providerLinkId: 'abc123',
      };
      link.model.shortLink.create.mockResolvedValue({ id: 'l1', ...data });

      await repo.recordLink(data);

      expect(link.model.shortLink.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('findLinkByShortUrl', () => {
    it('queries by compound unique key', async () => {
      const shortUrl = 'https://bit.ly/abc';
      const mockData = { id: 'l1', shortUrl };
      link.model.shortLink.findUnique.mockResolvedValue(mockData);

      const result = await repo.findLinkByShortUrl(orgId, shortUrl);

      expect(link.model.shortLink.findUnique).toHaveBeenCalledWith({
        where: { organizationId_shortUrl: { organizationId: orgId, shortUrl } },
      });
      expect(result).toEqual(mockData);
    });
  });

  describe('getLinksForOrg', () => {
    it('queries by orgId ordered by createdAt desc', async () => {
      const mockData = [{ id: 'l1' }, { id: 'l2' }];
      link.model.shortLink.findMany.mockResolvedValue(mockData);

      const result = await repo.getLinksForOrg(orgId);

      expect(link.model.shortLink.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(mockData);
    });
  });

  describe('upsertSnapshotFull', () => {
    it('creates a new snapshot when none exists', async () => {
      const date = new Date('2024-01-01');
      snapshot.model.shortLinkSnapshot.findUnique.mockResolvedValue(null);
      snapshot.model.shortLinkSnapshot.create.mockResolvedValue({ id: 's1' });

      await repo.upsertSnapshotFull('link-1', orgId, date, 42);

      expect(snapshot.model.shortLinkSnapshot.findUnique).toHaveBeenCalledWith({
        where: { shortLinkId_date: { shortLinkId: 'link-1', date } },
      });
      expect(snapshot.model.shortLinkSnapshot.create).toHaveBeenCalledWith({
        data: { shortLinkId: 'link-1', organizationId: orgId, date, clicks: 42 },
      });
    });

    it('updates an existing snapshot', async () => {
      const date = new Date('2024-01-01');
      snapshot.model.shortLinkSnapshot.findUnique.mockResolvedValue({ id: 's1' });
      snapshot.model.shortLinkSnapshot.update.mockResolvedValue({ id: 's1', clicks: 99 });

      await repo.upsertSnapshotFull('link-1', orgId, date, 99);

      expect(snapshot.model.shortLinkSnapshot.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { clicks: 99 },
      });
    });
  });

  describe('upsertSnapshotsBatch', () => {
    it('does nothing for an empty batch', async () => {
      const result = await repo.upsertSnapshotsBatch([]);

      expect(result).toEqual([]);
      expect(snapshot.model.shortLinkSnapshot.upsert).not.toHaveBeenCalled();
      expect(transaction.model.$transaction).not.toHaveBeenCalled();
    });

    it('builds one upsert per row and writes them in a single transaction', async () => {
      const date = new Date('2024-01-01');
      const rows = [
        { shortLinkId: 'link-1', organizationId: orgId, date, clicks: 42 },
        { shortLinkId: 'link-2', organizationId: orgId, date, clicks: 7 },
      ];

      await repo.upsertSnapshotsBatch(rows);

      expect(snapshot.model.shortLinkSnapshot.upsert).toHaveBeenCalledTimes(2);
      expect(snapshot.model.shortLinkSnapshot.upsert).toHaveBeenCalledWith({
        where: { shortLinkId_date: { shortLinkId: 'link-1', date } },
        create: { shortLinkId: 'link-1', organizationId: orgId, date, clicks: 42 },
        update: { clicks: 42 },
      });
      // a single transaction carrying both upsert operations
      expect(transaction.model.$transaction).toHaveBeenCalledTimes(1);
      expect(transaction.model.$transaction).toHaveBeenCalledWith([
        expect.anything(),
        expect.anything(),
      ]);
    });
  });

  describe('getSnapshotsForLinks', () => {
    it('queries by orgId and shortLinkIds', async () => {
      const mockData = [{ id: 's1', clicks: 10 }];
      snapshot.model.shortLinkSnapshot.findMany.mockResolvedValue(mockData);

      const result = await repo.getSnapshotsForLinks(orgId, ['l1', 'l2']);

      expect(snapshot.model.shortLinkSnapshot.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, shortLinkId: { in: ['l1', 'l2'] } },
        orderBy: { date: 'asc' },
      });
      expect(result).toEqual(mockData);
    });

    it('filters by date range when provided', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');
      snapshot.model.shortLinkSnapshot.findMany.mockResolvedValue([]);

      await repo.getSnapshotsForLinks(orgId, ['l1'], from, to);

      expect(snapshot.model.shortLinkSnapshot.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          shortLinkId: { in: ['l1'] },
          date: { gte: from, lte: to },
        },
        orderBy: { date: 'asc' },
      });
    });
  });

  describe('pruneSnapshots', () => {
    it('returns early when org has no links', async () => {
      link.model.shortLink.findMany.mockResolvedValue([]);

      const result = await repo.pruneSnapshots(orgId, new Date('2024-01-01'));

      expect(result).toEqual({ count: 0 });
      expect(snapshot.model.shortLinkSnapshot.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes snapshots older than the cutoff date', async () => {
      const before = new Date('2024-06-01');
      link.model.shortLink.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);
      snapshot.model.shortLinkSnapshot.deleteMany.mockResolvedValue({ count: 5 });

      const result = await repo.pruneSnapshots(orgId, before);

      expect(snapshot.model.shortLinkSnapshot.deleteMany).toHaveBeenCalledWith({
        where: {
          shortLinkId: { in: ['l1', 'l2'] },
          date: { lt: before },
        },
      });
      expect(result).toEqual({ count: 5 });
    });
  });

  describe('getAggregatedClicks', () => {
    it('queries by orgId and date range with include', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');
      const mockData = [{ id: 's1', clicks: 42, shortLink: { id: 'l1' } }];
      snapshot.model.shortLinkSnapshot.findMany.mockResolvedValue(mockData);

      const result = await repo.getAggregatedClicks(orgId, from, to);

      expect(snapshot.model.shortLinkSnapshot.findMany).toHaveBeenCalledWith({
        where: { organizationId: orgId, date: { gte: from, lte: to } },
        include: { shortLink: true },
        orderBy: { date: 'asc' },
      });
      expect(result).toEqual(mockData);
    });
  });
});
