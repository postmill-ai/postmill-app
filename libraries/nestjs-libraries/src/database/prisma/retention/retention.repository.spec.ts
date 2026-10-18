import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetentionRepository } from './retention.repository';

const makePrisma = () => ({
  aiDesignerSession: {
    findMany: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  design: { findMany: vi.fn().mockResolvedValue([]) },
  file: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RetentionRepository — AI Designer session purge intermediates', () => {
  const oneOldSession = {
    id: 's1',
    activeDesignIds: ['d1'],
    config: { referenceFileIds: ['ref-1', 'lib-1'] },
  };

  const prime = (prisma: ReturnType<typeof makePrisma>) => {
    prisma.aiDesignerSession.findMany
      .mockResolvedValueOnce([oneOldSession])
      .mockResolvedValue([]);
    // First file.findMany call = session-stamped assets; second = references.
    prisma.file.findMany
      .mockResolvedValueOnce([{ id: 'keep-1' }, { id: 'old-1' }])
      .mockResolvedValueOnce([{ id: 'ref-1' }]);
    prisma.design.findMany.mockResolvedValue([
      {
        doc: {
          outputs: [
            { children: [{ type: 'image', fileId: 'keep-1' }] },
          ],
        },
      },
    ]);
    prisma.file.updateMany.mockResolvedValue({ count: 2 });
  };

  it('soft-deletes session intermediates but keeps delivered-referenced files', async () => {
    const prisma = makePrisma();
    prime(prisma);
    const repo = new RetentionRepository(prisma as any);

    const purged = await repo.purgeAiDesignerSessionsOlderThan(new Date());

    expect(purged).toBe(1);
    expect(prisma.aiDesignerSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1'] } },
    });
    const update = prisma.file.updateMany.mock.calls[0][0];
    expect(update.where.id.in.sort()).toEqual(['old-1', 'ref-1']);
    expect(update.where.deletedAt).toBeNull();
    expect(update.data.deletedAt).toBeInstanceOf(Date);
  });

  it('scopes the reference lookup to rows actually stamped as references', async () => {
    const prisma = makePrisma();
    prime(prisma);
    const repo = new RetentionRepository(prisma as any);

    await repo.purgeAiDesignerSessionsOlderThan(new Date());

    const referenceQuery = prisma.file.findMany.mock.calls[1][0];
    expect(referenceQuery.where.id.in).toEqual(['ref-1', 'lib-1']);
    expect(referenceQuery.where.metadata).toEqual({
      path: ['aiDesigner'],
      equals: 'reference',
    });
  });

  it('still purges the sessions when the intermediate sweep fails', async () => {
    const prisma = makePrisma();
    prisma.aiDesignerSession.findMany
      .mockResolvedValueOnce([oneOldSession])
      .mockResolvedValue([]);
    prisma.design.findMany.mockRejectedValue(new Error('db down'));
    const repo = new RetentionRepository(prisma as any);

    const purged = await repo.purgeAiDesignerSessionsOlderThan(new Date());

    expect(purged).toBe(1);
    expect(prisma.aiDesignerSession.deleteMany).toHaveBeenCalled();
  });

  it('skips the file sweep entirely when no candidates match', async () => {
    const prisma = makePrisma();
    prisma.aiDesignerSession.findMany
      .mockResolvedValueOnce([{ id: 's1', activeDesignIds: null, config: null }])
      .mockResolvedValue([]);
    const repo = new RetentionRepository(prisma as any);

    await repo.purgeAiDesignerSessionsOlderThan(new Date());

    expect(prisma.file.updateMany).not.toHaveBeenCalled();
    expect(prisma.design.findMany).not.toHaveBeenCalled();
  });
});

describe('RetentionRepository — design version purge', () => {
  it('hard-deletes versions of designs soft-deleted past the window, batched', async () => {
    const prisma = {
      designVersion: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'v1' }, { id: 'v2' }])
          .mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const repo = new RetentionRepository(prisma as any);
    const cutoff = new Date('2026-09-01T00:00:00Z');

    const purged = await repo.purgeSoftDeletedDesignVersions(cutoff);

    expect(purged).toBe(2);
    expect(prisma.designVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { design: { deletedAt: { not: null, lt: cutoff } } },
      })
    );
    expect(prisma.designVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['v1', 'v2'] } },
    });
  });

  it('is a no-op when nothing matches', async () => {
    const prisma = {
      designVersion: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
    };
    const repo = new RetentionRepository(prisma as any);

    expect(await repo.purgeSoftDeletedDesignVersions(new Date())).toBe(0);
    expect(prisma.designVersion.deleteMany).not.toHaveBeenCalled();
  });
});

describe('RetentionRepository — blank design purge', () => {
  const makeBlankPrisma = () => ({
    design: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    file: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  });

  it('soft-deletes only blank untouched "Untitled Design" rows and their preview files', async () => {
    const prisma = makeBlankPrisma();
    const cutoff = new Date('2026-10-17T00:00:00Z');
    prisma.design.findMany.mockResolvedValueOnce([
      // Blank image canvas → purged (with its preview file).
      {
        id: 'd1',
        doc: { mode: 'image', outputs: [{ children: [], pages: [{ children: [] }] }] },
        previewFileId: 'f1',
      },
      // Blank video canvas (clip-less tracks) → purged, no preview file.
      {
        id: 'd2',
        doc: { mode: 'video', outputs: [{ tracks: [{ clips: [] }] }] },
        previewFileId: null,
      },
      // Content on page 2 → NOT blank, survives.
      {
        id: 'd3',
        doc: { mode: 'image', outputs: [{ children: [], pages: [{ children: [{ type: 'text' }] }] }] },
        previewFileId: 'f3',
      },
      // Video with a clip → survives.
      {
        id: 'd4',
        doc: { mode: 'video', outputs: [{ tracks: [{ clips: [{ id: 'c1' }] }] }] },
        previewFileId: 'f4',
      },
    ]).mockResolvedValue([]);
    const repo = new RetentionRepository(prisma as any);

    const purged = await repo.purgeBlankDesigns(cutoff);

    expect(purged).toBe(2);
    // Candidate filter: live rows, default name, untouched past the window.
    expect(prisma.design.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          name: 'Untitled Design',
          updatedAt: { lt: cutoff },
        },
      })
    );
    const designUpdate = prisma.design.updateMany.mock.calls[0][0];
    expect(designUpdate.where.id.in.sort()).toEqual(['d1', 'd2']);
    expect(designUpdate.where.deletedAt).toBeNull();
    expect(designUpdate.data.deletedAt).toBeInstanceOf(Date);
    // Only the purged designs' preview files are trashed (f3/f4 survive).
    const fileUpdate = prisma.file.updateMany.mock.calls[0][0];
    expect(fileUpdate.where.id.in).toEqual(['f1']);
    expect(fileUpdate.where.deletedAt).toBeNull();
  });

  it('pages past examined non-blank rows with skip', async () => {
    const prisma = makeBlankPrisma();
    const full = Array.from({ length: 500 }, (_, i) => ({
      id: `keep-${i}`,
      doc: { mode: 'image', outputs: [{ children: [{ type: 'text' }] }] },
      previewFileId: null,
    }));
    prisma.design.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([
        { id: 'blank-1', doc: { mode: 'image', outputs: [{ children: [] }] }, previewFileId: null },
      ])
      .mockResolvedValue([]);
    const repo = new RetentionRepository(prisma as any);

    const purged = await repo.purgeBlankDesigns(new Date());

    expect(purged).toBe(1);
    expect(prisma.design.findMany).toHaveBeenCalledTimes(2);
    // Second fetch skips the 500 already-examined non-blank rows.
    expect(prisma.design.findMany.mock.calls[1][0].skip).toBe(500);
  });

  it('is a no-op when no candidates match', async () => {
    const prisma = makeBlankPrisma();
    prisma.design.findMany.mockResolvedValue([]);
    const repo = new RetentionRepository(prisma as any);

    expect(await repo.purgeBlankDesigns(new Date())).toBe(0);
    expect(prisma.design.updateMany).not.toHaveBeenCalled();
    expect(prisma.file.updateMany).not.toHaveBeenCalled();
  });
});
