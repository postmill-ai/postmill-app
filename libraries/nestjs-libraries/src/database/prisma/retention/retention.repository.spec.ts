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
