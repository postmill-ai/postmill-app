import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: vi.fn(function() { return { model: {} }; }),
}));

import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AiRagRepository } from './ai-rag.repository';

describe('AiRagRepository', () => {
  let repository: AiRagRepository;

  // The single injected PrismaRepository's `.model` is the raw PrismaService at
  // runtime — it carries both the typed aIContentIndex model AND the raw
  // $executeRawUnsafe / $queryRawUnsafe / $transaction methods, plus post/media.
  let model: {
    aIContentIndex: Record<string, ReturnType<typeof vi.fn>>;
    post: Record<string, ReturnType<typeof vi.fn>>;
    media: Record<string, ReturnType<typeof vi.fn>>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    model = {
      aIContentIndex: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
      },
      post: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      media: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      // Default $transaction runs the callback against the same `model` mock so
      // tx.aIContentIndex / tx.$executeRawUnsafe resolve.
      $transaction: vi.fn(async (fn: any) => fn(model)),
    };

    const repo = new (PrismaRepository as any)();
    repo.model = model;

    repository = new AiRagRepository(repo);
  });

  describe('ensurePgvectorTable', () => {
    it('runs CREATE EXTENSION, CREATE TABLE, and both indexes with the given dimension', async () => {
      await repository.ensurePgvectorTable(1536);

      expect(model.$executeRawUnsafe).toHaveBeenCalledTimes(4);
      const sqls = model.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);

      expect(sqls[0]).toBe('CREATE EXTENSION IF NOT EXISTS vector');
      expect(sqls[1]).toContain('CREATE TABLE IF NOT EXISTS "AIContentEmbedding"');
      expect(sqls[1]).toContain('"contentIndexId" text PRIMARY KEY REFERENCES "AIContentIndex"(id) ON DELETE CASCADE');
      expect(sqls[1]).toContain('"embedding" vector(1536) NOT NULL');
      expect(sqls[2]).toContain('CREATE INDEX IF NOT EXISTS idx_ai_content_embedding_org');
      expect(sqls[3]).toContain('USING hnsw (embedding vector_cosine_ops)');
      expect(sqls[3]).toContain('WITH (m = 16, ef_construction = 200)');
    });

    it('embeds a custom dimension into the table DDL', async () => {
      await repository.ensurePgvectorTable(1024);
      const sqls = model.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
      expect(sqls[1]).toContain('"embedding" vector(1024) NOT NULL');
    });

    it('propagates DDL errors so the caller can fall back', async () => {
      model.$executeRawUnsafe.mockRejectedValue(new Error('pgvector not installed'));
      await expect(repository.ensurePgvectorTable(1536)).rejects.toThrow('pgvector not installed');
    });
  });

  describe('findContentHash', () => {
    it('selects the contentHash for the source', async () => {
      model.aIContentIndex.findFirst.mockResolvedValue({ contentHash: 'abc' });

      const result = await repository.findContentHash('org-1', 'post', 'p1');

      expect(model.aIContentIndex.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', sourceType: 'post', sourceId: 'p1' },
        select: { contentHash: true },
      });
      expect(result).toEqual({ contentHash: 'abc' });
    });

    it('returns null when none exists', async () => {
      model.aIContentIndex.findFirst.mockResolvedValue(null);
      expect(await repository.findContentHash('org-1', 'post', 'p1')).toBeNull();
    });
  });

  describe('replaceSourceChunks', () => {
    beforeEach(() => {
      model.aIContentIndex.create.mockImplementation((data: any) =>
        Promise.resolve({ ...data.data, id: `idx-${data.data.chunkIndex}` }),
      );
    });

    it('deletes the source rows then creates one row per chunk inside the transaction', async () => {
      const result = await repository.replaceSourceChunks({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'p1',
        contentHash: 'hash-1',
        chunks: ['a.', 'b.'],
        embeddings: [],
        pgvectorAvailable: false,
        formatVector: (arr) => '[' + arr.join(',') + ']',
      });

      expect(model.$transaction).toHaveBeenCalledTimes(1);
      expect(model.aIContentIndex.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', sourceType: 'post', sourceId: 'p1' },
      });
      expect(model.aIContentIndex.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        { id: 'idx-0', chunkIndex: 0, chunk: 'a.' },
        { id: 'idx-1', chunkIndex: 1, chunk: 'b.' },
      ]);
      // No embedding writes when pgvector is unavailable.
      expect(model.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('upserts embeddings on the same tx client with $1/$2/$3::vector params when pgvector is available', async () => {
      await repository.replaceSourceChunks({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'p1',
        contentHash: 'hash-1',
        chunks: ['a.', 'b.'],
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        pgvectorAvailable: true,
        formatVector: (arr) => '[' + arr.join(',') + ']',
      });

      expect(model.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      const [sql, p1, p2, p3] = model.$executeRawUnsafe.mock.calls[0];
      expect(sql).toBe(
        `INSERT INTO "AIContentEmbedding" ("contentIndexId", "organizationId", "embedding") VALUES ($1, $2, $3::vector) ON CONFLICT ("contentIndexId") DO UPDATE SET "embedding" = $3::vector`,
      );
      expect(p1).toBe('idx-0');
      expect(p2).toBe('org-1');
      expect(p3).toBe('[0.1,0.2]');
    });

    it('skips empty embeddings but still writes the non-empty ones', async () => {
      await repository.replaceSourceChunks({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'p1',
        contentHash: 'hash-1',
        chunks: ['a.', 'b.'],
        embeddings: [[], [0.3, 0.4]],
        pgvectorAvailable: true,
        formatVector: (arr) => '[' + arr.join(',') + ']',
      });

      expect(model.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      expect(model.$executeRawUnsafe.mock.calls[0][1]).toBe('idx-1');
    });

    it('does not write embeddings when counts mismatch', async () => {
      await repository.replaceSourceChunks({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'p1',
        contentHash: 'hash-1',
        chunks: ['a.', 'b.'],
        embeddings: [[0.1, 0.2]],
        pgvectorAvailable: true,
        formatVector: (arr) => '[' + arr.join(',') + ']',
      });

      expect(model.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('rejects more than 5000 chunks as a hard backstop', async () => {
      const chunks = new Array(5001).fill('chunk');
      await expect(
        repository.replaceSourceChunks({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'p1',
          contentHash: 'hash-1',
          chunks,
          embeddings: [],
          pgvectorAvailable: false,
          formatVector: (arr) => '[' + arr.join(',') + ']',
        }),
      ).rejects.toThrow('Too many chunks for a single source');

      expect(model.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findChunksForBm25', () => {
    it('fetches a bounded org-scoped set of non-null chunks', async () => {
      const rows = [{ id: 'c1', chunk: 'x', sourceType: 'post', sourceId: 'p1' }];
      model.aIContentIndex.findMany.mockResolvedValue(rows);

      const result = await repository.findChunksForBm25('org-1');

      expect(model.aIContentIndex.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', chunk: { not: null } },
        select: { id: true, chunk: true, sourceType: true, sourceId: true },
        take: 500,
      });
      expect(result).toEqual(rows);
    });
  });

  describe('vectorSearch', () => {
    it('issues the cosine search with $1::vector / org / limit and normalizes scores', async () => {
      model.$queryRawUnsafe.mockResolvedValue([
        { text: 't', sourceType: 'post', sourceId: 'p1', score: 0.9 },
      ]);

      const result = await repository.vectorSearch('org-1', '[0.1,0.2]', 5);

      const [sql, p1, p2, p3] = model.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('(1 - (e.embedding <=> $1::vector)) AS score');
      expect(sql).toContain('FROM "AIContentEmbedding" e');
      expect(sql).toContain('JOIN "AIContentIndex" ci ON ci.id = e."contentIndexId"');
      expect(sql).toContain('WHERE e."organizationId" = $2');
      expect(sql).toContain('ORDER BY e.embedding <=> $1::vector');
      expect(sql).toContain('LIMIT $3');
      expect(p1).toBe('[0.1,0.2]');
      expect(p2).toBe('org-1');
      expect(p3).toBe(5);
      expect(result).toEqual([{ text: 't', sourceType: 'post', sourceId: 'p1', score: 0.9 }]);
    });

    it('parses string scores to numbers', async () => {
      model.$queryRawUnsafe.mockResolvedValue([
        { text: 't', sourceType: 'post', sourceId: 'p1', score: '0.5' },
      ]);
      const result = await repository.vectorSearch('org-1', '[0.1]', 3);
      expect(result[0].score).toBe(0.5);
    });
  });

  describe('textSearchRecent', () => {
    it('returns recent chunks with score 0', async () => {
      model.aIContentIndex.findMany.mockResolvedValue([
        { chunk: 'recent', sourceType: 'post', sourceId: 'p1' },
        { chunk: null, sourceType: 'media', sourceId: 'm1' },
      ]);

      const result = await repository.textSearchRecent('org-1', 5);

      expect(model.aIContentIndex.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', chunk: { not: null } },
        select: { chunk: true, sourceType: true, sourceId: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        { text: 'recent', sourceType: 'post', sourceId: 'p1', score: 0 },
        { text: '', sourceType: 'media', sourceId: 'm1', score: 0 },
      ]);
    });
  });

  describe('textSearchTerms', () => {
    it('builds OR-ed ILIKE clauses and parameterizes terms, org, and limit', async () => {
      model.$queryRawUnsafe.mockResolvedValue([
        { text: 'm', sourceType: 'post', sourceId: 'p1', score: 1 },
      ]);

      const result = await repository.textSearchTerms('org-1', ['foo', 'bar'], 5);

      const [sql, ...params] = model.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('COUNT(*)::float / 2::float AS score');
      expect(sql).toContain(`ci.chunk ILIKE '%' || $1 || '%' OR ci.chunk ILIKE '%' || $2 || '%'`);
      expect(sql).toContain('ci."organizationId" = $3');
      expect(sql).toContain('LIMIT $4');
      expect(params).toEqual(['foo', 'bar', 'org-1', 5]);
      expect(result).toEqual([{ text: 'm', sourceType: 'post', sourceId: 'p1', score: 1 }]);
    });

    it('parses string scores to numbers', async () => {
      model.$queryRawUnsafe.mockResolvedValue([
        { text: 'm', sourceType: 'post', sourceId: 'p1', score: '0.25' },
      ]);
      const result = await repository.textSearchTerms('org-1', ['foo'], 5);
      expect(result[0].score).toBe(0.25);
    });
  });

  describe('findPostsForBackfill', () => {
    it('fetches non-deleted posts for the org', async () => {
      const posts = [{ id: 'p1', content: 'c', title: 't', description: 'd' }];
      model.post.findMany.mockResolvedValue(posts);

      const result = await repository.findPostsForBackfill('org-1');

      expect(model.post.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt: null },
        select: { id: true, content: true, title: true, description: true },
      });
      expect(result).toEqual(posts);
    });
  });

  describe('findMediaForBackfill', () => {
    it('fetches non-deleted media for the org', async () => {
      const media = [{ id: 'm1', name: 'n', originalName: 'o', alt: 'a' }];
      model.media.findMany.mockResolvedValue(media);

      const result = await repository.findMediaForBackfill('org-1');

      expect(model.media.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt: null },
        select: { id: true, name: true, originalName: true, alt: true },
      });
      expect(result).toEqual(media);
    });
  });
});
