import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageProviderType } from '@prisma/client';

const mockModel = {
  storageProviderConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  fileFolder: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  file: {
    findMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
  },
  organization: {
    findUnique: vi.fn(),
  },
};

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {
    get model() {
      return mockModel;
    }
  },
}));

import { StorageRepository } from './storage.repository';

function makeRepo() {
  const storage = { model: mockModel } as any;
  const folder = { model: mockModel } as any;
  const media = { model: mockModel } as any;
  const org = { model: mockModel } as any;
  return new StorageRepository(storage, folder, media, org);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StorageRepository', () => {
  describe('findByOrg', () => {
    it('returns all configs for an org, ordered by creation', async () => {
      mockModel.storageProviderConfig.findMany.mockResolvedValue([
        { id: '1', organizationId: 'org-1', type: 'LOCAL' },
      ]);
      const repo = makeRepo();

      const result = await repo.findByOrg('org-1');

      expect(result).toHaveLength(1);
      expect(mockModel.storageProviderConfig.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('countSourceMedia', () => {
    it('counts LOCAL unfoldered media and sums their size', async () => {
      mockModel.file.count.mockResolvedValue(5);
      mockModel.file.aggregate.mockResolvedValue({
        _sum: { fileSize: 1024 },
      });
      const repo = makeRepo();

      const result = await repo.countSourceMedia('org-1', {
        id: 'src',
        type: StorageProviderType.LOCAL,
      });

      expect(result.count).toBe(5);
      expect(result.totalBytes).toBe(BigInt(1024));
      expect(mockModel.file.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: 'org-1' }),
        })
      );
    });

    it('counts cloud-mounted media for a specific provider', async () => {
      mockModel.file.count.mockResolvedValue(3);
      mockModel.file.aggregate.mockResolvedValue({
        _sum: { fileSize: 2048 },
      });
      const repo = makeRepo();

      const result = await repo.countSourceMedia('org-1', {
        id: 'cloud-1',
        type: StorageProviderType.S3,
      });

      expect(result.count).toBe(3);
      expect(result.totalBytes).toBe(BigInt(2048));
    });
  });

  describe('findSourceMediaPage', () => {
    it('returns a page of media with cursor', async () => {
      mockModel.file.findMany.mockResolvedValue([
        { id: 'm1', name: 'a.png', path: 'p1', type: 'image', fileSize: 10 },
      ]);
      const repo = makeRepo();

      const result = await repo.findSourceMediaPage('org-1', {
        id: 'src',
        type: StorageProviderType.LOCAL,
      }, 'cursor-1', 25);

      expect(result).toHaveLength(1);
      expect(mockModel.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.any(Object),
          take: 25,
          skip: 1,
          cursor: { id: 'cursor-1' },
        })
      );
    });

    it('starts from the beginning without a cursor', async () => {
      mockModel.file.findMany.mockResolvedValue([]);
      const repo = makeRepo();

      await repo.findSourceMediaPage('org-1', {
        id: 'src',
        type: StorageProviderType.LOCAL,
      }, undefined, 10);

      const call = mockModel.file.findMany.mock.calls[0][0];
      expect(call).not.toHaveProperty('cursor');
      expect(call).not.toHaveProperty('skip');
    });
  });

  describe('updateMediaLocation', () => {
    it('updates a media item path and folder scoped by org', async () => {
      mockModel.file.update.mockResolvedValue({ id: 'm1' });
      const repo = makeRepo();

      await repo.updateMediaLocation('org-1', 'm1', 'new-path', 'folder-1');

      expect(mockModel.file.update).toHaveBeenCalledWith({
        where: { id: 'm1', organizationId: 'org-1' },
        data: { path: 'new-path', folderId: 'folder-1' },
      });
    });
  });

  describe('findMountFolder', () => {
    it('finds the root folder for a mounted provider', async () => {
      mockModel.fileFolder.findFirst.mockResolvedValue({
        id: 'folder-1',
        storageProviderId: 'provider-1',
      });
      const repo = makeRepo();

      const result = await repo.findMountFolder('org-1', 'provider-1');

      expect(result).toEqual({ id: 'folder-1', storageProviderId: 'provider-1' });
    });
  });

  describe('removeOrDetachMountFolders', () => {
    it('deletes empty mount folders in one batch scoped to org', async () => {
      mockModel.fileFolder.findMany.mockResolvedValue([
        {
          id: 'folder-1',
          storageProviderId: 'provider-1',
          organizationId: 'org-1',
          _count: { files: 0, children: 0 },
        },
        {
          id: 'folder-2',
          storageProviderId: 'provider-1',
          organizationId: 'org-1',
          _count: { files: 0, children: 0 },
        },
      ]);
      mockModel.fileFolder.deleteMany = vi.fn().mockResolvedValue({ count: 2 });
      const repo = makeRepo();

      await repo.removeOrDetachMountFolders('org-1', 'provider-1');

      expect(mockModel.fileFolder.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', storageProviderId: 'provider-1' },
        include: { _count: { select: { files: true, children: true } } },
      });
      expect(mockModel.fileFolder.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['folder-1', 'folder-2'] }, organizationId: 'org-1' },
      });
    });

    it('detaches non-empty folders in one batch instead of deleting scoped to org', async () => {
      mockModel.fileFolder.findMany.mockResolvedValue([
        {
          id: 'folder-1',
          storageProviderId: 'provider-1',
          organizationId: 'org-1',
          _count: { files: 5, children: 0 },
        },
        {
          id: 'folder-2',
          storageProviderId: 'provider-1',
          organizationId: 'org-1',
          _count: { files: 0, children: 1 },
        },
      ]);
      mockModel.fileFolder.updateMany = vi
        .fn()
        .mockResolvedValue({ count: 2 });
      const repo = makeRepo();

      await repo.removeOrDetachMountFolders('org-1', 'provider-1');

      expect(mockModel.fileFolder.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['folder-1', 'folder-2'] }, organizationId: 'org-1' },
        data: { storageProviderId: null },
      });
    });
  });

  describe('getOrgQuota', () => {
    it('returns the org quota or default', async () => {
      mockModel.organization.findUnique.mockResolvedValue({
        localStorageQuotaBytes: BigInt(1000),
      });
      const repo = makeRepo();

      const result = await repo.getOrgQuota('org-1');

      expect(result).toBe(BigInt(1000));
    });

    it('defaults to 5GB when org not found', async () => {
      mockModel.organization.findUnique.mockResolvedValue(null);
      const repo = makeRepo();

      const result = await repo.getOrgQuota('org-1');

      expect(result).toBe(BigInt(5368709120));
    });
  });

  describe('getStorageUsedByOrg', () => {
    it('returns sum of file sizes for an org', async () => {
      mockModel.file.aggregate.mockResolvedValue({
        _sum: { fileSize: 1000 },
      });
      const repo = makeRepo();

      const result = await repo.getStorageUsedByOrg('org-1');

      expect(result).toBe(BigInt(1000));
    });

    it('returns 0 when no media', async () => {
      mockModel.file.aggregate.mockResolvedValue({
        _sum: { fileSize: null },
      });
      const repo = makeRepo();

      const result = await repo.getStorageUsedByOrg('org-1');

      expect(result).toBe(BigInt(0));
    });
  });

  describe('getUsageByFolder — bounded Prisma queries (#67)', () => {
    it('uses only one groupBy and one batched folder lookup for many folders', async () => {
      mockModel.file.groupBy.mockResolvedValue([
        { folderId: 'f1', _sum: { fileSize: 100 } },
        { folderId: 'f2', _sum: { fileSize: 200 } },
        { folderId: 'f3', _sum: { fileSize: 300 } },
      ]);
      mockModel.fileFolder.findMany.mockResolvedValue([
        { id: 'f1', name: 'A' },
        { id: 'f2', name: 'B' },
        { id: 'f3', name: 'C' },
      ]);
      const repo = makeRepo();

      const result = await repo.getUsageByFolder('org-1');

      expect(result).toHaveLength(3);
      expect(mockModel.file.groupBy).toHaveBeenCalledTimes(1);
      expect(mockModel.fileFolder.findMany).toHaveBeenCalledTimes(1);
      expect(mockModel.fileFolder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['f1', 'f2', 'f3'] } }),
        }),
      );
    });
  });

  describe('getUsageByProvider — bounded Prisma queries (#67)', () => {
    it('uses one groupBy, one batched folder lookup, and one provider lookup', async () => {
      mockModel.file.groupBy.mockResolvedValue([
        { folderId: 'f1', _sum: { fileSize: 100 } },
        { folderId: 'f2', _sum: { fileSize: 200 } },
        { folderId: 'f3', _sum: { fileSize: 300 } },
        { folderId: null, _sum: { fileSize: 50 } },
      ]);
      mockModel.fileFolder.findMany.mockResolvedValue([
        { id: 'f1', storageProviderId: 's3-1' },
        { id: 'f2', storageProviderId: 's3-1' },
        { id: 'f3', storageProviderId: 'r2-1' },
      ]);
      mockModel.storageProviderConfig.findMany.mockResolvedValue([
        { id: 's3-1', name: 'S3' },
        { id: 'r2-1', name: 'R2' },
      ]);
      const repo = makeRepo();

      const result = await repo.getUsageByProvider('org-1');

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.providerId)).toEqual(
        expect.arrayContaining(['s3-1', 'r2-1', 'local']),
      );
      expect(mockModel.file.groupBy).toHaveBeenCalledTimes(1);
      expect(mockModel.fileFolder.findMany).toHaveBeenCalledTimes(1);
      expect(mockModel.storageProviderConfig.findMany).toHaveBeenCalledTimes(1);
      expect(mockModel.storageProviderConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });
  });

  describe('updateHealthCheck', () => {
    it('sets lastHealthCheck on success scoped by org', async () => {
      mockModel.storageProviderConfig.update.mockResolvedValue({
        id: 'p1',
        lastHealthCheck: new Date(),
        lastHealthError: null,
      });
      const repo = makeRepo();

      await repo.updateHealthCheck('org-1', 'p1', true);

      expect(mockModel.storageProviderConfig.update).toHaveBeenCalledWith({
        where: { id: 'p1', organizationId: 'org-1' },
        data: { lastHealthCheck: expect.any(Date), lastHealthError: null },
      });
    });

    it('sets lastHealthError on failure scoped by org', async () => {
      mockModel.storageProviderConfig.update.mockResolvedValue({
        id: 'p1',
        lastHealthError: 'Connection failed',
      });
      const repo = makeRepo();

      await repo.updateHealthCheck('org-1', 'p1', false, 'Connection failed');

      expect(mockModel.storageProviderConfig.update).toHaveBeenCalledWith({
        where: { id: 'p1', organizationId: 'org-1' },
        data: { lastHealthError: 'Connection failed' },
      });
    });
  });
});
