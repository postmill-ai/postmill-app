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

  it('deleteFolder succeeds when the folder holds only trashed templates', async () => {
    const { repo, model } = makeRepo();
    model.designTemplateFolder.findUnique.mockResolvedValue({
      id: 'f1',
      _count: { children: 0 },
    });
    model.designTemplate.count.mockResolvedValue(0);
    model.designTemplateFolder.delete.mockResolvedValue({ id: 'f1' });

    const result = await repo.deleteFolder('org-1', 'f1');

    expect(result).toEqual({ id: 'f1' });
    expect(model.designTemplate.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          folderId: 'f1',
          organizationId: 'org-1',
          deletedAt: null,
        }),
      })
    );
  });

  it('deleteFolder throws when active templates or subfolders remain', async () => {
    const { repo, model } = makeRepo();
    model.designTemplateFolder.findUnique.mockResolvedValue({
      id: 'f2',
      _count: { children: 0 },
    });
    model.designTemplate.count.mockResolvedValue(2);

    await expect(repo.deleteFolder('org-1', 'f2')).rejects.toThrow('Folder is not empty');
    expect(model.designTemplateFolder.delete).not.toHaveBeenCalled();

    model.designTemplate.count.mockResolvedValue(0);
    model.designTemplateFolder.findUnique.mockResolvedValue({
      id: 'f3',
      _count: { children: 1 },
    });

    await expect(repo.deleteFolder('org-1', 'f3')).rejects.toThrow('Folder is not empty');
    expect(model.designTemplateFolder.delete).not.toHaveBeenCalled();
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
