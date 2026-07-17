import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeaturedProviderRepository } from './featured-provider.repository';

describe('FeaturedProviderRepository', () => {
  let repository: FeaturedProviderRepository;
  let featuredProviderModel: Record<string, ReturnType<typeof vi.fn>>;
  let transactionModel: { $transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    featuredProviderModel = {
      findMany: vi.fn().mockResolvedValue([]),
      // Each upsert returns a sentinel "prisma promise" op so we can assert the
      // exact set handed to $transaction.
      upsert: vi.fn((arg: any) => ({ __op: 'upsert', arg })),
    };
    transactionModel = {
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const featuredProvider = { model: { featuredProvider: featuredProviderModel } } as any;
    const transaction = { model: transactionModel } as any;
    repository = new FeaturedProviderRepository(featuredProvider, transaction);
  });

  // 6.1: reorder must run the upserts atomically in a single $transaction, not a
  // sequential await loop (partial ordering on a mid-loop failure).
  describe('reorder (6.1 atomic)', () => {
    it('wraps every upsert in one $transaction call', async () => {
      await repository.reorder('ai', [
        { providerId: 'openai', sortOrder: 0 },
        { providerId: 'anthropic', sortOrder: 1 },
      ]);

      expect(transactionModel.$transaction).toHaveBeenCalledTimes(1);
      const ops = transactionModel.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(2);
      expect(featuredProviderModel.upsert).toHaveBeenCalledTimes(2);
      expect(featuredProviderModel.upsert).toHaveBeenNthCalledWith(1, {
        where: { domain_providerId: { domain: 'ai', providerId: 'openai' } },
        create: { domain: 'ai', providerId: 'openai', sortOrder: 0 },
        update: { sortOrder: 0 },
      });
      expect(featuredProviderModel.upsert).toHaveBeenNthCalledWith(2, {
        where: { domain_providerId: { domain: 'ai', providerId: 'anthropic' } },
        create: { domain: 'ai', providerId: 'anthropic', sortOrder: 1 },
        update: { sortOrder: 1 },
      });
    });

    it('returns the domain listing after the transaction commits', async () => {
      featuredProviderModel.findMany.mockResolvedValue([
        { domain: 'ai', providerId: 'openai', sortOrder: 0 },
      ]);
      const result = await repository.reorder('ai', [{ providerId: 'openai', sortOrder: 0 }]);
      expect(featuredProviderModel.findMany).toHaveBeenCalledWith({
        where: { domain: 'ai' },
        orderBy: [{ domain: 'asc' }, { sortOrder: 'asc' }],
      });
      expect(result).toEqual([{ domain: 'ai', providerId: 'openai', sortOrder: 0 }]);
    });

    it('issues an empty transaction for no entries', async () => {
      await repository.reorder('ai', []);
      expect(transactionModel.$transaction).toHaveBeenCalledWith([]);
      expect(featuredProviderModel.upsert).not.toHaveBeenCalled();
    });
  });
});
