import { Injectable } from '@nestjs/common';
import { Prisma, StorageProviderType } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class StorageRepository {
  constructor(
    private _storage: PrismaRepository<'storageProviderConfig'>,
    private _folder: PrismaRepository<'fileFolder'>,
    private _file: PrismaRepository<'file'>,
    private _org: PrismaRepository<'organization'>
  ) {}

  findByOrg(orgId: string) {
    return this._storage.model.storageProviderConfig.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByFingerprint(orgId: string, fingerprint: string) {
    return this._storage.model.storageProviderConfig.findFirst({
      where: { organizationId: orgId, accountFingerprint: fingerprint },
    });
  }

  findById(orgId: string, id: string) {
    return this._storage.model.storageProviderConfig.findUnique({
      where: { id, organizationId: orgId },
    });
  }

  create(data: {
    organizationId: string;
    type: StorageProviderType;
    name: string;
    credentials?: string;
    region?: string;
    bucket?: string;
    endpoint?: string;
    publicUrl?: string;
    quotaBytes?: bigint;
    accountFingerprint?: string;
    version?: string;
  }) {
    return this._storage.model.storageProviderConfig.create({
      data: { ...data, version: data.version ?? 'v1' },
    });
  }

  update(
    orgId: string,
    id: string,
    data: {
      name?: string;
      credentials?: string;
      region?: string;
      bucket?: string;
      endpoint?: string;
      publicUrl?: string;
      quotaBytes?: bigint;
      mounted?: boolean;
    }
  ) {
    return this._storage.model.storageProviderConfig.update({
      where: { id, organizationId: orgId },
      data,
    });
  }

  delete(orgId: string, id: string) {
    return this._storage.model.storageProviderConfig.delete({
      where: { id, organizationId: orgId },
    });
  }

  findMountedByOrg(orgId: string) {
    return this._storage.model.storageProviderConfig.findMany({
      where: { organizationId: orgId, mounted: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  countByOrg(orgId: string) {
    return this._storage.model.storageProviderConfig.count({
      where: { organizationId: orgId },
    });
  }

  // ── Org quota (#57) ──
  async getOrgQuota(orgId: string): Promise<bigint> {
    const org = await this._org.model.organization.findUnique({
      where: { id: orgId },
      select: { localStorageQuotaBytes: true },
    });
    if (org?.localStorageQuotaBytes) return org.localStorageQuotaBytes;

    const envGb = parseInt(process.env.LOCAL_STORAGE_QUOTA_GB || '5', 10);
    return BigInt(envGb) * BigInt(1024 * 1024 * 1024);
  }

  async setOrgQuota(orgId: string, quotaBytes: bigint): Promise<void> {
    await this._org.model.organization.update({
      where: { id: orgId },
      data: { localStorageQuotaBytes: quotaBytes },
    });
  }

  // ── Migration source-media resolution (#48/#50) ──
  // For a LOCAL source, "owned" media is everything not pinned to a cloud-mounted
  // folder (root files + files in folders with no storageProviderId). For a cloud
  // source, it is media in folders mapped to that provider.
  #sourceMediaWhere(
    orgId: string,
    source: { id: string; type: StorageProviderType }
  ): Prisma.FileWhereInput {
    if (source.type === StorageProviderType.LOCAL) {
      return {
        organizationId: orgId,
        deletedAt: null,
        OR: [{ folderId: null }, { folder: { storageProviderId: null } }],
      };
    }
    return {
      organizationId: orgId,
      deletedAt: null,
      folder: { storageProviderId: source.id },
    };
  }

  async countSourceMedia(
    orgId: string,
    source: { id: string; type: StorageProviderType }
  ): Promise<{ count: number; totalBytes: bigint }> {
    const where = this.#sourceMediaWhere(orgId, source);
    const [count, agg] = await Promise.all([
      this._file.model.file.count({ where }),
      this._file.model.file.aggregate({ where, _sum: { fileSize: true } }),
    ]);
    return { count, totalBytes: BigInt(agg._sum.fileSize ?? 0) };
  }

  findSourceMediaPage(
    orgId: string,
    source: { id: string; type: StorageProviderType },
    cursor: string | undefined,
    limit: number
  ) {
    const where = this.#sourceMediaWhere(orgId, source);
    return this._file.model.file.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, name: true, path: true, type: true, fileSize: true },
    });
  }

  updateMediaLocation(orgId: string, id: string, path: string, folderId: string | null) {
    return this._file.model.file.update({
      where: { id, organizationId: orgId },
      data: { path, folderId },
    });
  }

  // ── Mount-folder lifecycle (#55) ──
  findMountFolder(orgId: string, providerId: string) {
    return this._folder.model.fileFolder.findFirst({
      where: { organizationId: orgId, storageProviderId: providerId },
    });
  }

  createMountFolder(orgId: string, providerId: string, name: string) {
    return this._folder.model.fileFolder.create({
      data: { organizationId: orgId, name, storageProviderId: providerId },
    });
  }

  async removeOrDetachMountFolders(orgId: string, providerId: string) {
    const folders = await this._folder.model.fileFolder.findMany({
      where: { organizationId: orgId, storageProviderId: providerId },
      include: { _count: { select: { files: true, children: true } } },
    });
    const emptyIds = folders
      .filter((f) => f._count.files === 0 && f._count.children === 0)
      .map((f) => f.id);
    const nonEmptyIds = folders
      .filter((f) => f._count.files > 0 || f._count.children > 0)
      .map((f) => f.id);

    if (emptyIds.length) {
      await this._folder.model.fileFolder.deleteMany({
        where: { id: { in: emptyIds }, organizationId: orgId },
      });
    }
    if (nonEmptyIds.length) {
      await this._folder.model.fileFolder.updateMany({
        where: { id: { in: nonEmptyIds }, organizationId: orgId },
        data: { storageProviderId: null },
      });
    }
  }

  async getStorageUsedByOrg(orgId: string): Promise<bigint> {
    const result = await this._file.model.file.aggregate({
      where: { organizationId: orgId },
      _sum: { fileSize: true },
    });
    return BigInt(result._sum?.fileSize ?? 0);
  }

  async getUsageByFolder(
    orgId: string
  ): Promise<Array<{ folderId: string; folderName: string; totalBytes: bigint }>> {
    const result = await this._file.model.file.groupBy({
      by: ['folderId'],
      where: { organizationId: orgId },
      _sum: { fileSize: true },
    });

    const folderIds = result.map((row) => row.folderId).filter(Boolean) as string[];
    const nameById = new Map<string, string>();
    if (folderIds.length > 0) {
      const folders = await this._folder.model.fileFolder.findMany({
        where: { id: { in: folderIds } },
        select: { id: true, name: true },
      });
      for (const folder of folders) {
        nameById.set(folder.id, folder.name);
      }
    }

    const withNames = result.map((row) => ({
      folderId: row.folderId || 'unfoldered',
      folderName: row.folderId ? nameById.get(row.folderId) || 'Unknown' : 'Unfoldered',
      totalBytes: BigInt(row._sum?.fileSize ?? 0),
    }));

    return withNames.sort((a, b) => (b.totalBytes > a.totalBytes ? 1 : -1));
  }

  async getUsageByProvider(
    orgId: string
  ): Promise<Array<{ providerId: string; providerName: string; totalBytes: bigint }>> {
    const result = await this._file.model.file.groupBy({
      by: ['folderId'],
      where: { organizationId: orgId },
      _sum: { fileSize: true },
    });

    const folderIds = result.map((row) => row.folderId).filter(Boolean) as string[];
    const providerByFolderId = new Map<string, string | null>();
    if (folderIds.length > 0) {
      const folders = await this._folder.model.fileFolder.findMany({
        where: { id: { in: folderIds } },
        select: { id: true, storageProviderId: true },
      });
      for (const folder of folders) {
        providerByFolderId.set(folder.id, folder.storageProviderId);
      }
    }

    const byProvider = new Map<string, bigint>();
    for (const row of result) {
      const providerId = row.folderId
        ? providerByFolderId.get(row.folderId) || 'local'
        : 'local';
      const currentBytes = byProvider.get(providerId) || BigInt(0);
      byProvider.set(providerId, currentBytes + BigInt(row._sum?.fileSize ?? 0));
    }

    const providers = await this._storage.model.storageProviderConfig.findMany({
      where: { organizationId: orgId },
    });

    return Array.from(byProvider.entries())
      .map(([providerId, totalBytes]) => {
        const provider = providers.find((p) => p.id === providerId);
        return {
          providerId,
          providerName: provider?.name || 'Unknown',
          totalBytes,
        };
      })
      .sort((a, b) => (b.totalBytes > a.totalBytes ? 1 : -1));
  }

  async updateHealthCheck(
    orgId: string,
    id: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this._storage.model.storageProviderConfig.update({
      where: { id, organizationId: orgId },
      data: success
        ? { lastHealthCheck: new Date(), lastHealthError: null }
        : { lastHealthError: error },
    });
  }

  setDefaultFolder(providerId: string, folderId: string | null, orgId: string) {
    return this._storage.model.storageProviderConfig.update({
      where: { id: providerId, organizationId: orgId },
      data: { defaultFolderId: folderId },
    });
  }

  getProviderForFolder(folderId: string, orgId: string) {
    return this._folder.model.fileFolder.findFirst({
      where: { id: folderId, organizationId: orgId },
      select: { storageProviderId: true },
    });
  }

  // Ancestor-aware folder lookup: walks parentId chain to find the mount-root
  // folder carrying storageProviderId. Returns minimal shape for the walk.
  findFolderWithProvider(id: string, orgId: string) {
    return this._folder.model.fileFolder.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, parentId: true, storageProviderId: true, organizationId: true },
    });
  }

  // Direct folder lookup scoped to an org.
  findFolder(id: string, orgId: string) {
    return this._folder.model.fileFolder.findFirst({
      where: { id, organizationId: orgId },
    });
  }
}
