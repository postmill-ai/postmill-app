import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesignRepository } from './design.repository';

function makeModel() {
  return {
    design: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    designTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    designTemplateFolder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    designVersion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    file: {
      findFirst: vi.fn(),
    },
  };
}

function makeRepo(model = makeModel()) {
  return {
    repo: new DesignRepository(
      { model } as any,
      { model } as any,
      { model } as any,
      { model } as any,
      { model } as any
    ),
    model,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DesignRepository — template folders', () => {
  it('getFolderTree fetches org folders once and nests them in memory', async () => {
    const { repo, model } = makeRepo();
    model.designTemplateFolder.findMany.mockResolvedValue([
      { id: 'a', name: 'Ads', parentId: null, _count: { templates: 2, children: 1 } },
      { id: 'b', name: 'Black Friday', parentId: 'a', _count: { templates: 1, children: 0 } },
      { id: 'c', name: 'Organic', parentId: null, _count: { templates: 0, children: 0 } },
    ]);

    const tree = await repo.getFolderTree('org-1');

    expect(model.designTemplateFolder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        orderBy: { name: 'asc' },
      })
    );
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('b');
    expect(tree[1].children).toEqual([]);
  });

  it('createFolder defaults a missing parentId to root (null)', async () => {
    const { repo, model } = makeRepo();
    model.designTemplateFolder.create.mockResolvedValue({ id: 'f1' });

    await repo.createFolder('org-1', { name: 'Ads' });

    expect(model.designTemplateFolder.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', name: 'Ads', parentId: null },
    });
  });

  it('deleteFolder deletes the row — the FKs unfile its contents', async () => {
    // Both FKs (templates.folderId, folders.parentId) are ON DELETE SET NULL:
    // deleting the row unfiles templates and re-parents children to root. The
    // emptiness guard lives in the service.
    const { repo, model } = makeRepo();
    model.designTemplateFolder.findUnique.mockResolvedValue({ id: 'f1' });
    model.designTemplateFolder.delete.mockResolvedValue({ id: 'f1' });

    const result = await repo.deleteFolder('org-1', 'f1');

    expect(result).toEqual({ id: 'f1' });
    expect(model.designTemplateFolder.delete).toHaveBeenCalledWith({
      where: { id: 'f1', organizationId: 'org-1' },
    });
  });

  it('countFolderActiveContents counts live templates and child folders', async () => {
    const { repo, model } = makeRepo();
    model.designTemplate.count.mockResolvedValue(2);
    model.designTemplateFolder.count.mockResolvedValue(1);

    const result = await repo.countFolderActiveContents('org-1', 'f1');

    expect(result).toEqual({ templates: 2, children: 1 });
    // Soft-deleted templates are excluded: a folder holding only trashed
    // templates counts as empty.
    expect(model.designTemplate.count).toHaveBeenCalledWith({
      where: { folderId: 'f1', organizationId: 'org-1', deletedAt: null },
    });
    expect(model.designTemplateFolder.count).toHaveBeenCalledWith({
      where: { parentId: 'f1', organizationId: 'org-1' },
    });
  });

  it('deleteFolder returns null for a missing folder', async () => {
    const { repo, model } = makeRepo();
    model.designTemplateFolder.findUnique.mockResolvedValue(null);

    expect(await repo.deleteFolder('org-1', 'nope')).toBeNull();
    expect(model.designTemplateFolder.delete).not.toHaveBeenCalled();
  });

  it('moveTemplate updates folderId org-scoped (null = root)', async () => {
    const { repo, model } = makeRepo();
    model.designTemplate.update.mockResolvedValue({ id: 't1', folderId: null });

    await repo.moveTemplate('org-1', 't1', null);

    expect(model.designTemplate.update).toHaveBeenCalledWith({
      where: { id: 't1', organizationId: 'org-1' },
      data: { folderId: null },
    });
  });
});

describe('DesignRepository — design versions', () => {
  it('listVersions strips the doc column (metadata only)', async () => {
    const { repo, model } = makeRepo();
    model.designVersion.findMany.mockResolvedValue([]);

    await repo.listVersions('org-1', 'd1');

    expect(model.designVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { designId: 'd1', organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      })
    );
    const select = model.designVersion.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('doc');
    expect(select).toHaveProperty('id');
    expect(select).toHaveProperty('auto');
  });

  it('findVersion is scoped by org AND design', async () => {
    const { repo, model } = makeRepo();
    model.designVersion.findFirst.mockResolvedValue({ id: 'v1' });

    await repo.findVersion('org-1', 'd1', 'v1');

    expect(model.designVersion.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', designId: 'd1', organizationId: 'org-1' },
    });
  });

  it('trimVersions deletes everything past the newest `keep` of its class', async () => {
    const { repo, model } = makeRepo();
    model.designVersion.findMany.mockResolvedValue([{ id: 'v3' }, { id: 'v4' }]);
    model.designVersion.deleteMany.mockResolvedValue({ count: 2 });

    const removed = await repo.trimVersions('d1', false, 2);

    expect(model.designVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { designId: 'd1', auto: false },
        orderBy: { createdAt: 'desc' },
        skip: 2,
      })
    );
    expect(model.designVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['v3', 'v4'] } },
    });
    expect(removed).toBe(2);
  });

  it('trimVersions is a no-op inside the cap', async () => {
    const { repo, model } = makeRepo();
    model.designVersion.findMany.mockResolvedValue([]);

    expect(await repo.trimVersions('d1', true, 10)).toBe(0);
    expect(model.designVersion.deleteMany).not.toHaveBeenCalled();
  });
});

describe('DesignRepository — templates pagination', () => {
  it('findTemplatesByOrg without pagination returns the full list (no skip/take)', async () => {
    const { repo, model } = makeRepo();
    model.designTemplate.findMany.mockResolvedValue([]);

    await repo.findTemplatesByOrg('org-1');

    const args = model.designTemplate.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      OR: [{ organizationId: 'org-1' }, { isSystem: true }],
    });
    expect(args).not.toHaveProperty('skip');
    expect(args).not.toHaveProperty('take');
  });

  it('findTemplatesByOrg with page/limit applies skip/take', async () => {
    const { repo, model } = makeRepo();
    model.designTemplate.findMany.mockResolvedValue([]);

    await repo.findTemplatesByOrg('org-1', 3, 24);

    expect(model.designTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 48, take: 24 })
    );
  });

  it('countTemplatesByOrg counts the same org/system scope as the list', async () => {
    const { repo, model } = makeRepo();
    model.designTemplate.count.mockResolvedValue(7);

    expect(await repo.countTemplatesByOrg('org-1')).toBe(7);
    expect(model.designTemplate.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [{ organizationId: 'org-1' }, { isSystem: true }],
      },
    });
  });
});
