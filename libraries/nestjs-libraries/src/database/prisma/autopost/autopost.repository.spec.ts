import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function () {
    return { model: {} };
  }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AutopostRepository } from './autopost.repository';

describe('AutopostRepository', () => {
  let repository: AutopostRepository;
  let mockAutoPost: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAutoPost = {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({ id: 'ap-1', active: true }),
    };

    const autoPostRepo = new (PrismaRepository as any)();
    autoPostRepo.model = { autoPost: mockAutoPost };

    repository = new AutopostRepository(autoPostRepo);
  });

  describe('getAutopost', () => {
    it('scopes reads to the organization', async () => {
      mockAutoPost.findUnique.mockResolvedValue({
        id: 'ap-1',
        organizationId: 'org-1',
      });

      const result = await repository.getAutopost('ap-1', 'org-1');

      expect(mockAutoPost.findUnique).toHaveBeenCalledWith({
        where: { id: 'ap-1', organizationId: 'org-1', deletedAt: null },
      });
      expect(result).toEqual({ id: 'ap-1', organizationId: 'org-1' });
    });

    it('returns null for a cross-org autopost', async () => {
      mockAutoPost.findUnique.mockResolvedValue(null);

      const result = await repository.getAutopost('ap-1', 'org-2');

      expect(result).toBeNull();
    });
  });

  describe('updateUrl', () => {
    it('scopes updates to the organization', async () => {
      mockAutoPost.update.mockResolvedValue({
        id: 'ap-1',
        organizationId: 'org-1',
        lastUrl: 'https://example.com/new',
      });

      const result = await repository.updateUrl(
        'ap-1',
        'org-1',
        'https://example.com/new'
      );

      expect(mockAutoPost.update).toHaveBeenCalledWith({
        where: { id: 'ap-1', organizationId: 'org-1' },
        data: { lastUrl: 'https://example.com/new' },
      });
      expect(result.lastUrl).toBe('https://example.com/new');
    });

    it('rejects cross-org updates', async () => {
      mockAutoPost.update.mockRejectedValue({ code: 'P2025' });

      await expect(
        repository.updateUrl('ap-1', 'org-2', 'https://example.com/new')
      ).rejects.toBeDefined();
    });
  });
});
