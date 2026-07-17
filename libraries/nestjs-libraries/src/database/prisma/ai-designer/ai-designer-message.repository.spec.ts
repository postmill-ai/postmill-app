import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  incrby: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redisMock,
}));

import { AiDesignerMessageRepository } from './ai-designer-message.repository';

const p2002 = () => {
  const err = new Error('Unique constraint failed') as Error & { code: string };
  err.code = 'P2002';
  return err;
};

describe('AiDesignerMessageRepository seq self-heal', () => {
  let prisma: {
    aiDesignerMessage: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let repo: AiDesignerMessageRepository;

  const baseMsg = {
    sessionId: 's1',
    role: 'user',
    kind: 'text',
    content: { kind: 'text', text: 'hi' } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.expire.mockResolvedValue(1);
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);
    prisma = {
      aiDesignerMessage: {
        create: vi.fn(async ({ data }) => ({ id: 'm1', ...data })),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    repo = new AiDesignerMessageRepository(prisma as any);
  });

  it('uses the Redis counter on the happy path', async () => {
    redisMock.incr.mockResolvedValue(7);
    const row = await repo.createNext(baseMsg);
    expect(row.seq).toBe(7);
    expect(redisMock.expire).toHaveBeenCalled();
    expect(prisma.aiDesignerMessage.findFirst).not.toHaveBeenCalled();
  });

  it('re-seeds a fresh counter from the DB max (lost Redis key)', async () => {
    // INCR returns 1 (key was lost) while the session already has 40 rows.
    redisMock.incr.mockResolvedValue(1);
    redisMock.incrby.mockResolvedValue(41);
    prisma.aiDesignerMessage.findFirst.mockResolvedValue({ seq: 40 });

    const row = await repo.createNext(baseMsg);
    expect(redisMock.incrby).toHaveBeenCalledWith('ai-designer:seq:s1', 40);
    expect(row.seq).toBe(41);
  });

  it('recovers from a P2002 collision by re-seeding and retrying once', async () => {
    // Counter says 3 but seq 3 already exists; after re-seed the counter
    // resumes past the DB max.
    redisMock.incr.mockResolvedValueOnce(3).mockResolvedValueOnce(41);
    prisma.aiDesignerMessage.findFirst.mockResolvedValue({ seq: 40 });
    prisma.aiDesignerMessage.create
      .mockRejectedValueOnce(p2002())
      .mockImplementationOnce(async ({ data }: any) => ({ id: 'm2', ...data }));

    const row = await repo.createNext(baseMsg);
    expect(row.seq).toBe(41);
    expect(redisMock.set).toHaveBeenCalledWith(
      'ai-designer:seq:s1',
      '40',
      'EX',
      expect.any(Number)
    );
  });

  it('falls back to DB max+1 when Redis is down', async () => {
    redisMock.incr.mockRejectedValue(new Error('redis down'));
    prisma.aiDesignerMessage.findFirst.mockResolvedValue({ seq: 12 });
    const row = await repo.createNext(baseMsg);
    expect(row.seq).toBe(13);
  });

  it('rethrows non-P2002 create errors without retry', async () => {
    redisMock.incr.mockResolvedValue(5);
    prisma.aiDesignerMessage.create.mockRejectedValue(new Error('boom'));
    await expect(repo.createNext(baseMsg)).rejects.toThrow('boom');
    expect(prisma.aiDesignerMessage.create).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed message content before persisting', async () => {
    redisMock.incr.mockResolvedValue(5);
    await expect(
      repo.createNext({
        ...baseMsg,
        content: { kind: 'text', unexpected: 'value' } as any,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiDesignerMessage.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown message kind before persisting', async () => {
    redisMock.incr.mockResolvedValue(5);
    await expect(
      repo.createNext({
        ...baseMsg,
        content: { kind: 'unknown', text: 'hi' } as any,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aiDesignerMessage.create).not.toHaveBeenCalled();
  });
});
