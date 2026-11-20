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
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    designerRecentOpen: {
      upsert: vi.fn(),
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
    designBatch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
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
  it('findTemplatesByOrg without pagination returns the full list (no LIMIT/OFFSET)', async () => {
    const { repo, model } = makeRepo();

    await repo.findTemplatesByOrg('org-1');

    const [sql, orgId] = model.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('(t."organizationId" = $1 OR t."isSystem" = true)');
    expect(sql).not.toContain('LIMIT');
    expect(sql).not.toContain('OFFSET');
    expect(orgId).toBe('org-1');
  });

  it('findTemplatesByOrg with page/limit applies bounded SQL pagination', async () => {
    const { repo, model } = makeRepo();

    await repo.findTemplatesByOrg('org-1', 3, 24);

    const [sql, ...params] = model.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('LIMIT $2 OFFSET $3');
    expect(params).toEqual(['org-1', 24, 48]);
  });

  it('prioritizes the selected brand in SQL before applying pagination', async () => {
    const { repo, model } = makeRepo();
    model.$queryRawUnsafe.mockResolvedValue([{ id: 'brand-template' }, { id: 'shared-template' }]);
    model.designTemplate.findMany.mockResolvedValue([
      { id: 'shared-template', name: 'Shared' },
      { id: 'brand-template', name: 'Brand' },
    ]);

    const result = await repo.findTemplatesByOrg('org-1', 1, 24, 'brand-1');

    expect(model.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('CASE WHEN t."brandProfileId" = $2 THEN 0 ELSE 1 END'),
      'org-1', 'brand-1', 24, 0,
    );
    expect(result.map((template) => template.id)).toEqual(['brand-template', 'shared-template']);
  });

  it('countTemplatesByOrg counts the same org/system scope and filters as the list', async () => {
    const { repo, model } = makeRepo();
    model.$queryRawUnsafe.mockResolvedValue([{ total: 7 }]);

    expect(await repo.countTemplatesByOrg('org-1', undefined, { query: 'Launch' })).toBe(7);
    const [sql, ...params] = model.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('SELECT COUNT(*)::int AS total');
    expect(sql).toContain('(t."organizationId" = $1 OR t."isSystem" = true)');
    expect(sql).toContain('POSITION');
    expect(params).toEqual(['org-1', 'Launch', 'Launch']);
  });

  it('uses per-user history for recent design ordering and stable name ordering', async () => {
    const { repo, model } = makeRepo();
    model.$queryRawUnsafe.mockResolvedValue([{ id: 'd1' }]);
    model.design.findMany.mockResolvedValue([{ id: 'd1', name: 'One' }]);

    await repo.findByOrg('org-1', 1, 24, { sort: 'recent', userId: 'user-1', query: 'one' });
    const [recentSql, ...recentParams] = model.$queryRawUnsafe.mock.calls[0];
    expect(recentSql).toContain('LEFT JOIN "DesignerRecentOpen"');
    expect(recentSql).toContain('r."openedAt" DESC NULLS LAST');
    expect(recentSql).toContain('d."id" ASC');
    expect(recentParams).toContain('user-1');

    await repo.findByOrg('org-1', 1, 24, { sort: 'name' });
    expect(model.$queryRawUnsafe.mock.calls[1][0]).toContain('LOWER(d."name") ASC');
  });

  it('filters templates by no folder and canonical category without system rows', async () => {
    const { repo, model } = makeRepo();

    await repo.findTemplatesByOrg('org-1', 1, 24, undefined, undefined, {
      folderId: null,
      category: 'ig-post',
      sort: 'newest',
    });

    const [sql, ...params] = model.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('t."organizationId" = $1');
    expect(sql).toContain('t."folderId" IS NULL');
    expect(params).toEqual(expect.arrayContaining(['ig-post', 'instagram-post', 'instagram post', 'ig post']));
    expect(sql).toContain('t."createdAt" DESC');
  });

  it('reads document mode only for uncategorized facet and video/other filter rows', async () => {
    const { repo, model } = makeRepo();

    await repo.listTemplateCategories('org-1');
    await repo.findTemplatesByOrg('org-1', 1, 24, undefined, undefined, { category: 'video' });
    await repo.countTemplatesByOrg('org-1', undefined, { category: 'other' });

    const guardedMode = "CASE WHEN TRIM(COALESCE(t.\"category\", '')) = '' THEN COALESCE(t.doc->>'mode', 'image') ELSE 'image' END";
    for (const [sql] of model.$queryRawUnsafe.mock.calls) {
      expect(sql).toContain(guardedMode);
    }
    expect(model.$queryRawUnsafe.mock.calls[0][0]).toContain(`${guardedMode} AS mode`);
  });
});


describe('DesignRepository — Bulk Create batches', () => {
  it('keeps batch lists, counts, and lookups scoped to the organization', async () => {
    const { repo, model } = makeRepo();
    model.designBatch.findMany.mockResolvedValue([]);
    model.designBatch.findFirst.mockResolvedValue(null);
    model.designBatch.count.mockResolvedValue(0);

    await repo.findBatchesByOrg('org-1', 2, 25);
    await repo.countBatchesByOrg('org-1');
    await repo.findBatchByJobId('org-1', 'job-1');

    const where = { organizationId: 'org-1', designs: { some: { deletedAt: null } } };
    expect(model.designBatch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where,
      skip: 25,
      take: 25,
    }));
    expect(model.designBatch.count).toHaveBeenCalledWith({ where });
    expect(model.designBatch.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', jobId: 'job-1' },
    });
  });

  it('loads only live member metadata and includes batch identity on a full design', async () => {
    const { repo, model } = makeRepo();
    model.designBatch.findFirst.mockResolvedValue(null);
    model.design.findFirst.mockResolvedValue(null);

    await repo.findBatchById('org-1', 'batch-1');
    await repo.findById('org-1', 'design-1');

    expect(model.designBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'batch-1', organizationId: 'org-1' },
    }));
    const memberQuery = model.designBatch.findFirst.mock.calls[0][0].include.designs;
    expect(memberQuery.where).toEqual({ deletedAt: null });
    expect(memberQuery.select).toEqual({
      id: true,
      name: true,
      updatedAt: true,
      previewFile: { select: { path: true } },
    });
    expect(memberQuery.select).not.toHaveProperty('doc');
    expect(memberQuery.select).not.toHaveProperty('previewDataUrl');
    expect(model.design.findFirst).toHaveBeenCalledWith({
      where: { id: 'design-1', organizationId: 'org-1', deletedAt: null },
      include: { batch: { select: { id: true, name: true } } },
    });
  });

  it('filters batched variations only for the opt-in root listing', async () => {
    const { repo, model } = makeRepo();
    model.design.findMany.mockResolvedValue([]);
    model.design.count.mockResolvedValue(0);

    await repo.findByOrg('org-1', 1, 50, true);
    await repo.countByOrg('org-1', true);

    const where = { organizationId: 'org-1', deletedAt: null, batchId: null };
    expect(model.design.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(model.design.count).toHaveBeenCalledWith({ where });
  });

  it('deletes failed batch metadata with an org-scoped mutation', async () => {
    const { repo, model } = makeRepo();
    model.designBatch.deleteMany.mockResolvedValue({ count: 1 });

    await repo.deleteBatch('org-1', 'batch-1');

    expect(model.designBatch.deleteMany).toHaveBeenCalledWith({
      where: { id: 'batch-1', organizationId: 'org-1' },
    });
  });
});
