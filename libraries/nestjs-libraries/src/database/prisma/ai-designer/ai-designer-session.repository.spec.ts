import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerSessionRepository } from './ai-designer-session.repository';
import { BadRequestException } from '@nestjs/common';

describe('AiDesignerSessionRepository JSON validation', () => {
  let prisma: {
    aiDesignerSession: {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
  let repo: AiDesignerSessionRepository;

  const validConfig = {
    channels: ['ig-post'],
    variants: 1,
  };

  const validBrief = {
    intent: 'a promo post',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = {
      aiDesignerSession: {
        create: vi.fn(async ({ data }: any) => ({ id: 's1', ...data })),
        update: vi.fn(async ({ data }: any) => ({ id: 's1', ...data })),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        delete: vi.fn(),
      },
    };
    repo = new AiDesignerSessionRepository(prisma as any);
  });

  describe('create', () => {
    it('accepts valid JSON columns', async () => {
      await repo.create({
        organizationId: 'org-1',
        userId: 'user-1',
        mode: 'prompt',
        format: 'image',
        config: validConfig,
        brief: validBrief,
        state: 'intake',
        activeDesignIds: ['d1'],
      });

      expect(prisma.aiDesignerSession.create).toHaveBeenCalledTimes(1);
      const data = prisma.aiDesignerSession.create.mock.calls[0][0].data;
      expect(data.config).toEqual(validConfig);
      expect(data.brief).toEqual(validBrief);
      expect(data.activeDesignIds).toEqual(['d1']);
      expect(data.state).toBe('intake');
    });

    it('stores null for omitted brief and activeDesignIds', async () => {
      await repo.create({
        organizationId: 'org-1',
        userId: 'user-1',
        mode: 'prompt',
        format: 'image',
        config: validConfig,
      });

      const data = prisma.aiDesignerSession.create.mock.calls[0][0].data;
      expect(data.brief).toBeNull();
      expect(data.activeDesignIds).toBeNull();
      expect(data.state).toBe('intake');
    });

    it('rejects an invalid config shape', async () => {
      await expect(
        repo.create({
          organizationId: 'org-1',
          userId: 'user-1',
          mode: 'prompt',
          format: 'image',
          config: { channels: 'not-an-array' } as any,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.aiDesignerSession.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid activeDesignIds type', async () => {
      await expect(
        repo.create({
          organizationId: 'org-1',
          userId: 'user-1',
          mode: 'prompt',
          format: 'image',
          config: validConfig,
          activeDesignIds: 'not-an-array' as any,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.aiDesignerSession.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid state', async () => {
      await expect(
        repo.create({
          organizationId: 'org-1',
          userId: 'user-1',
          mode: 'prompt',
          format: 'image',
          config: validConfig,
          state: 'hacked' as any,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.aiDesignerSession.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('accepts valid partial JSON updates', async () => {
      await repo.update('s1', 'org-1', 'user-1', {
        brief: validBrief,
        activeDesignIds: ['d2'],
      });

      expect(prisma.aiDesignerSession.update).toHaveBeenCalledTimes(1);
      const data = prisma.aiDesignerSession.update.mock.calls[0][0].data;
      expect(data.brief).toEqual(validBrief);
      expect(data.activeDesignIds).toEqual(['d2']);
      expect(data.state).toBeUndefined();
      expect(data.config).toBeUndefined();
    });

    it('rejects an invalid brief shape', async () => {
      await expect(
        repo.update('s1', 'org-1', 'user-1', {
          brief: { intent: 123 } as any,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.aiDesignerSession.update).not.toHaveBeenCalled();
    });

    it('rejects too many active design ids', async () => {
      await expect(
        repo.update('s1', 'org-1', 'user-1', {
          activeDesignIds: Array(25).fill('d'),
        })
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.aiDesignerSession.update).not.toHaveBeenCalled();
    });
  });
});
