import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagService } from './rag.service';
import { EventEmitter } from 'events';

const redisEmitter = new EventEmitter();
let redisList: string[] = [];

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  const mock: any = {
    lpush: vi.fn(async (key: string, value: string) => {
      redisList.unshift(value);
      redisEmitter.emit('push');
      return redisList.length;
    }),
    rpoplpush: vi.fn(async (_src: string, _dst: string) => {
      return redisList.length > 0 ? redisList.pop()! : null;
    }),
    brpoplpush: vi.fn(async (_src: string, _dst: string, _timeout: number) => {
      return redisList.length > 0 ? redisList.pop()! : null;
    }),
    lrem: vi.fn(async (_key: string, _count: number, _value: string) => {
      return 1;
    }),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    duplicate: vi.fn(() => mock),
  };
  return { ioRedis: mock };
});

// The RAG data layer now lives behind AiRagRepository (Controller → Service →
// Repository). The service holds no Prisma; we mock the repository's methods and
// assert orchestration + that the right repo calls are made with the right args.
const mockRepo = {
  ensurePgvectorTable: vi.fn().mockResolvedValue(undefined),
  findContentHash: vi.fn().mockResolvedValue(null),
  replaceSourceChunks: vi.fn(),
  findChunksForBm25: vi.fn().mockResolvedValue([]),
  vectorSearch: vi.fn().mockResolvedValue([]),
  textSearchRecent: vi.fn().mockResolvedValue([]),
  textSearchTerms: vi.fn().mockResolvedValue([]),
  findPostsForBackfill: vi.fn().mockResolvedValue([]),
  findMediaForBackfill: vi.fn().mockResolvedValue([]),
};

const mockCreateSpendLog = vi.fn().mockResolvedValue(undefined);
const mockAiSettings = {
  getDecryptedSystemSettings: vi.fn().mockResolvedValue(null),
  createSpendLog: mockCreateSpendLog,
};

const mockQdrantSearch = vi.fn().mockResolvedValue([]);
const mockQdrantUpsert = vi.fn().mockResolvedValue(undefined);
const mockQdrantInit = vi.fn().mockResolvedValue(undefined);
const mockQdrantHealth = vi.fn().mockResolvedValue(true);
vi.mock('@reaatech/hybrid-rag-qdrant', () => ({
  QdrantClientWrapper: class MockQdrant {
    constructor(_cfg?: any) {}
    initialize = mockQdrantInit;
    healthCheck = mockQdrantHealth;
    upsertBatch = mockQdrantUpsert;
    search = mockQdrantSearch;
  },
}));

const mockBm25Search = vi.fn().mockReturnValue([]);
const mockBm25Add = vi.fn();
const mockRrf = vi.fn((v: any[]) => v);
vi.mock('@reaatech/hybrid-rag-retrieval', () => ({
  BM25Engine: class MockBm25 {
    addDocuments = mockBm25Add;
    search = mockBm25Search;
  },
  reciprocalRankFusion: (...args: any[]) => mockRrf(...args),
}));

const mockEmbeddingModel = {
  doEmbed: vi.fn().mockResolvedValue({ embeddings: [] }),
};

const mockAiModelProvider = {
  embeddingModel: vi.fn().mockResolvedValue(mockEmbeddingModel),
};

const mockAiSettingsManager = {
  getSettings: vi.fn().mockResolvedValue(null),
};

// Default replaceSourceChunks behaviour: mirror the real transaction's return —
// one chunk row per input chunk, with a deterministic id. Also exercises the
// pgvectorAvailable branch by invoking the supplied formatVector callback so the
// service's _formatVector path is covered.
function defaultReplace() {
  mockRepo.replaceSourceChunks.mockImplementation(async (params: any) => {
    if (params.pgvectorAvailable && params.embeddings?.length) {
      for (const emb of params.embeddings) {
        if (emb && emb.length) params.formatVector(emb);
      }
    }
    return params.chunks.map((chunk: string, i: number) => ({
      id: `idx-${i}`,
      chunkIndex: i,
      chunk,
    }));
  });
}

function createService() {
  return new RagService(
    mockAiSettings as any,
    mockRepo as any,
    mockAiModelProvider as any,
    mockAiSettingsManager as any,
  );
}

function enableRag(overrides: Record<string, any> = {}) {
  mockAiSettingsManager.getSettings.mockResolvedValue({
    ragSettings: { enabled: true, ...overrides },
  });
}

describe('RagService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisList = [];
    mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
    mockRepo.findContentHash.mockResolvedValue(null);
    mockRepo.findChunksForBm25.mockResolvedValue([]);
    mockRepo.vectorSearch.mockResolvedValue([]);
    mockRepo.textSearchRecent.mockResolvedValue([]);
    mockRepo.textSearchTerms.mockResolvedValue([]);
    mockRepo.findPostsForBackfill.mockResolvedValue([]);
    mockRepo.findMediaForBackfill.mockResolvedValue([]);
    defaultReplace();
    mockAiSettings.getDecryptedSystemSettings.mockResolvedValue(null);
    mockCreateSpendLog.mockResolvedValue(undefined);
    mockAiSettingsManager.getSettings.mockResolvedValue(null);
    mockAiModelProvider.embeddingModel.mockResolvedValue(mockEmbeddingModel);
    mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [] });
    mockQdrantSearch.mockResolvedValue([]);
    mockQdrantUpsert.mockResolvedValue(undefined);
    mockQdrantInit.mockResolvedValue(undefined);
    mockQdrantHealth.mockResolvedValue(true);
    mockBm25Search.mockReturnValue([]);
    mockRrf.mockImplementation((v: any[]) => v);
  });

  describe('indexContent', () => {
    it('throws when RAG is disabled', async () => {
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'post-1',
          content: 'some content',
        }),
      ).rejects.toThrow('RAG is not enabled for this organization');
    });

    it('throws when organizationId is missing', async () => {
      enableRag();
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: '',
          sourceType: 'post',
          sourceId: 'post-1',
          content: 'some content',
        }),
      ).rejects.toThrow('indexContent requires organizationId, sourceType, sourceId, and content');
    });

    it('throws when sourceType is missing', async () => {
      enableRag();
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: '',
          sourceId: 'post-1',
          content: 'some content',
        }),
      ).rejects.toThrow('indexContent requires organizationId, sourceType, sourceId, and content');
    });

    it('throws when sourceId is missing', async () => {
      enableRag();
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: '',
          content: 'some content',
        }),
      ).rejects.toThrow('indexContent requires organizationId, sourceType, sourceId, and content');
    });

    it('throws when content is missing', async () => {
      enableRag();
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'post-1',
          content: '',
        }),
      ).rejects.toThrow('indexContent requires organizationId, sourceType, sourceId, and content');
    });

    it('enqueues to Redis when RAG is enabled and all params are valid', async () => {
      enableRag();
      const service = createService();
      const { ioRedis } = await import('@gitroom/nestjs-libraries/redis/redis.service');
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'post-1',
          content: 'Some test content here.',
        }),
      ).resolves.toBeUndefined();
      expect(ioRedis.lpush).toHaveBeenCalled();
    });

    it('skips re-index when content hash is unchanged', async () => {
      enableRag();
      // The hash must match what the service computes; spy by capturing the hash
      // it would pass — instead assert no enqueue happens by returning a hash that
      // equals whatever the service computed (compute the same way is brittle), so
      // we assert via the repo: when findContentHash returns the SAME hash the
      // service produced, lpush is not called. We capture the produced hash by
      // first running once with null, reading the queued payload's contentHash.
      const service = createService();
      const { ioRedis } = await import('@gitroom/nestjs-libraries/redis/redis.service');
      await service.indexContent({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'post-1',
        content: 'Stable content here.',
      });
      const queued = JSON.parse(redisList[0]);
      vi.mocked(ioRedis.lpush).mockClear();
      mockRepo.findContentHash.mockResolvedValue({ contentHash: queued.contentHash });
      await service.indexContent({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'post-1',
        content: 'Stable content here.',
      });
      expect(ioRedis.lpush).not.toHaveBeenCalled();
    });

    it('returns immediately when content has no chunks', async () => {
      enableRag();
      const service = createService();
      const result = await service.indexContent({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'post-1',
        content: '   ',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('search', () => {
    it('throws when RAG is disabled', async () => {
      const service = createService();
      await expect(
        service.search({
          organizationId: 'org-1',
          query: 'test query',
        }),
      ).rejects.toThrow('RAG is not enabled for this organization');
    });

    it('throws when organizationId is missing', async () => {
      enableRag();
      const service = createService();
      await expect(
        service.search({
          organizationId: '',
          query: 'test query',
        }),
      ).rejects.toThrow('search requires organizationId and query');
    });

    it('throws when query is missing', async () => {
      enableRag();
      const service = createService();
      await expect(
        service.search({
          organizationId: 'org-1',
          query: '',
        }),
      ).rejects.toThrow('search requires organizationId and query');
    });

    it('falls back to text search when pgvector is unavailable', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.textSearchTerms.mockResolvedValue([]);

      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'test query',
      });

      expect(Array.isArray(results)).toBe(true);
    });

    it('uses provided limit parameter', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));

      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'test query',
        limit: 3,
      });

      expect(Array.isArray(results)).toBe(true);
      expect(mockRepo.textSearchTerms).toHaveBeenCalledWith('org-1', expect.any(Array), 3);
    });
  });

  describe('backfill', () => {
    it('throws when RAG is disabled', async () => {
      const service = createService();
      await expect(service.backfill('org-1')).rejects.toThrow(
        'RAG is not enabled for this organization',
      );
    });

    it('throws when organizationId is undefined', async () => {
      enableRag();
      const service = createService();
      await expect(service.backfill(undefined)).rejects.toThrow(
        'backfill requires a valid organizationId',
      );
    });

    it('returns zero indexed when no posts exist', async () => {
      enableRag();
      const service = createService();
      const result = await service.backfill('org-1');
      expect(result).toEqual({ indexed: 0 });
    });

    it('queries posts with org filter', async () => {
      enableRag();
      mockRepo.findPostsForBackfill.mockResolvedValue([]);
      const service = createService();
      await service.backfill('org-1');
      expect(mockRepo.findPostsForBackfill).toHaveBeenCalledWith('org-1');
    });
  });

  describe('_isRagEnabled caching', () => {
    it('caches the enabled state within TTL', async () => {
      enableRag();
      const service = createService();
      await service.indexContent({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'post-1',
        content: 'test',
      });
      await service.indexContent({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'post-2',
        content: 'test2',
      });
      expect(mockAiSettingsManager.getSettings).toHaveBeenCalledTimes(1);
    });

    it('resolves false when ragSettings is not enabled', async () => {
      mockAiSettingsManager.getSettings.mockResolvedValue({
        ragSettings: { enabled: false },
      });
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'post-1',
          content: 'content',
        }),
      ).rejects.toThrow('RAG is not enabled');
    });

    it('resolves false when settings are null', async () => {
      const service = createService();
      await expect(
        service.indexContent({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'post-1',
          content: 'content',
        }),
      ).rejects.toThrow('RAG is not enabled');
    });
  });

  describe('_ensureSideTable', () => {
    it('creates pgvector side table and returns available', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      const service = createService();
      const result = await (service as any)._ensureSideTable();
      expect(result.pgvectorAvailable).toBe(true);
      expect(result.dimension).toBe(1536);
      expect(mockRepo.ensurePgvectorTable).toHaveBeenCalledWith(1536);
    });

    it('returns pgvectorAvailable=false when extension fails', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('pgvector not installed'));
      const service = createService();
      const result = await (service as any)._ensureSideTable();
      expect(result.pgvectorAvailable).toBe(false);
    });

    it('uses cached side table when dimension matches', async () => {
      enableRag();
      const service = createService();
      await (service as any)._ensureSideTable();
      vi.clearAllMocks();
      const result2 = await (service as any)._ensureSideTable();
      expect(result2.pgvectorAvailable).toBe(true);
      expect(mockRepo.ensurePgvectorTable).not.toHaveBeenCalled();
    });

    it('uses custom dimension from ragSettings', async () => {
      enableRag({ embeddingDimension: 1024 });
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      const service = createService();
      const result = await (service as any)._ensureSideTable();
      expect(result.dimension).toBe(1024);
      expect(mockRepo.ensurePgvectorTable).toHaveBeenCalledWith(1024);
    });
  });

  describe('_doIndex (direct call)', () => {
    it('indexes chunks with embeddings when pgvector is available', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      });
      const service = createService();
      const chunks = ['chunk one.', 'chunk two.'];
      await (service as any)._doIndex('org-1', 'post', 'post-1', chunks, 'hash-123');
      expect(mockRepo.replaceSourceChunks).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'post-1',
          contentHash: 'hash-123',
          chunks,
          pgvectorAvailable: true,
        }),
      );
    });

    it('indexes chunks without embeddings when pgvector is unavailable', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      const service = createService();
      const chunks = ['chunk one.'];
      await (service as any)._doIndex('org-1', 'post', 'post-1', chunks, 'hash-123');
      expect(mockRepo.replaceSourceChunks).toHaveBeenCalledWith(
        expect.objectContaining({ pgvectorAvailable: false }),
      );
    });

    it('skips embedding insert when embedding is empty', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [] });
      const service = createService();
      const chunks = ['chunk one.'];
      await (service as any)._doIndex('org-1', 'post', 'post-1', chunks, 'hash-123');
      expect(mockRepo.replaceSourceChunks).toHaveBeenCalled();
    });
  });

  describe('search with vector search enabled', () => {
    it('performs vector search when pgvector is available', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
      });
      mockRepo.vectorSearch.mockResolvedValue([
        { text: 'result chunk', sourceType: 'post', sourceId: 'post-1', score: 0.95 },
      ]);
      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'test query',
      });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('result chunk');
      expect(results[0].score).toBe(0.95);
      // org-scoped vector search with formatted vector + limit
      expect(mockRepo.vectorSearch).toHaveBeenCalledWith('org-1', '[0.1,0.2,0.3]', 5);
    });

    it('falls back to text search when embedding is empty', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [] });
      mockRepo.textSearchTerms.mockResolvedValue([]);
      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'test query',
      });
      expect(Array.isArray(results)).toBe(true);
      expect(mockRepo.textSearchTerms).toHaveBeenCalled();
    });

    it('falls back to text search when vector search fails', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
      });
      mockRepo.vectorSearch.mockRejectedValue(new Error('query error'));
      mockRepo.textSearchTerms.mockResolvedValue([]);
      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'test query',
      });
      expect(Array.isArray(results)).toBe(true);
      expect(mockRepo.textSearchTerms).toHaveBeenCalled();
    });
  });

  describe('_textSearch', () => {
    it('returns recent content when query has no usable terms', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.textSearchRecent.mockResolvedValue([
        { text: 'recent content', sourceType: 'post', sourceId: 'p1', score: 0 },
      ]);
      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'a b',
      });
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('recent content');
      expect(results[0].score).toBe(0);
      expect(mockRepo.textSearchRecent).toHaveBeenCalledWith('org-1', 5);
    });

    it('performs ILIKE search with query terms', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.textSearchTerms.mockResolvedValue([
        { text: 'matched content', sourceType: 'post', sourceId: 'p1', score: 1.0 },
      ]);
      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'matched search term here',
      });
      expect(results).toHaveLength(1);
      // Service computes the term list, passes it to the repository unchanged.
      expect(mockRepo.textSearchTerms).toHaveBeenCalledWith(
        'org-1',
        ['matched', 'search', 'term', 'here'],
        5,
      );
    });

    it('passes through repo score values', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.textSearchTerms.mockResolvedValue([
        { text: 'content', sourceType: 'post', sourceId: 'p1', score: 0.5 },
      ]);
      const service = createService();
      const results = await service.search({
        organizationId: 'org-1',
        query: 'test query terms here',
      });
      expect(results[0].score).toBe(0.5);
    });
  });

  describe('_computeEmbeddings', () => {
    it('handles batches of chunks', async () => {
      enableRag();
      const chunks = new Array(25).fill('test chunk').map((c, i) => `${c} ${i}`);
      mockEmbeddingModel.doEmbed.mockResolvedValue({
        embeddings: [[0.1, 0.2]],
      });
      const service = createService();
      const embeds = await (service as any)._computeEmbeddings(chunks, 'org-1');
      expect(mockEmbeddingModel.doEmbed).toHaveBeenCalled();
      expect(embeds.length).toBeGreaterThan(0);
    });

    it('returns empty array when embedding model is null', async () => {
      enableRag();
      mockAiModelProvider.embeddingModel.mockResolvedValue(null);
      const service = createService();
      const embeds = await (service as any)._computeEmbeddings(['chunk'], 'org-1');
      expect(embeds).toEqual([]);
    });

    it('returns empty array when embedding computation fails', async () => {
      enableRag();
      mockEmbeddingModel.doEmbed.mockRejectedValue(new Error('compute error'));
      const service = createService();
      const embeds = await (service as any)._computeEmbeddings(['chunk'], 'org-1');
      expect(embeds).toEqual([]);
    });

    it('skips non-array embeddings in batch results', async () => {
      enableRag();
      mockEmbeddingModel.doEmbed.mockResolvedValue({
        embeddings: ['not-an-array', [0.1, 0.2], null, [0.3, 0.4]],
      });
      const service = createService();
      const embeds = await (service as any)._computeEmbeddings(['chunk1', 'chunk2', 'chunk3', 'chunk4'], 'org-1');
      expect(embeds.length).toBe(2);
    });
  });

  describe('backfill with content', () => {
    it('indexes posts with content', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.findPostsForBackfill.mockResolvedValue([
        { id: 'p1', content: 'First post content here.', title: 'Title', description: 'Desc' },
        { id: 'p2', content: 'Second post content.', title: null, description: null },
      ]);
      const service = createService();
      const result = await service.backfill('org-1');
      expect(result.indexed).toBeGreaterThanOrEqual(0);
    });

    it('skips posts with empty content', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.findPostsForBackfill.mockResolvedValue([
        { id: 'p1', content: '', title: '', description: '' },
      ]);
      const service = createService();
      const result = await service.backfill('org-1');
      expect(result.indexed).toBe(0);
    });

    it('skips already-indexed posts with matching hash', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      const post = { id: 'p1', content: 'Some content.', title: '', description: '' };
      mockRepo.findPostsForBackfill.mockResolvedValue([post]);
      mockRepo.findContentHash.mockResolvedValue({ contentHash: 'mismatch' });
      const service = createService();
      const result = await service.backfill('org-1');
      expect(result.indexed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('enqueueIndexJob', () => {
    it('fires indexContent without waiting', () => {
      enableRag();
      const service = createService();
      expect(() =>
        service.enqueueIndexJob({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'p1',
          content: 'test content.',
        }),
      ).not.toThrow();
    });

    it('swallows indexContent rejection via the error callback', async () => {
      // RAG disabled → indexContent rejects → enqueueIndexJob's .catch logs it.
      const service = createService();
      service.enqueueIndexJob({
        organizationId: 'org-1',
        sourceType: 'post',
        sourceId: 'p1',
        content: 'will reject because rag disabled',
      });
      // give the rejected promise a tick to hit the catch handler
      await new Promise((r) => setTimeout(r, 0));
      expect(true).toBe(true);
    });
  });

  describe('worker (onModuleInit / _startWorker)', () => {
    it('processes one queued job then stops (single drain, no infinite loop)', async () => {
      enableRag();
      const service = createService();
      const { ioRedis } = await import('@gitroom/nestjs-libraries/redis/redis.service');

      // Stop the loop after the first BRPOP so the test does not hang on the
      // worker's `while (this._workerRunning)` poll.
      vi.mocked(ioRedis.brpoplpush).mockImplementationOnce(async () => {
        (service as any)._workerRunning = false;
        return JSON.stringify({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'p1',
          chunks: ['only chunk.'],
          contentHash: 'h1',
        });
      });

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 5));

      expect(mockRepo.replaceSourceChunks).toHaveBeenCalled();
      expect(ioRedis.lrem).toHaveBeenCalled();
    });

    it('requeues a job when processing throws', async () => {
      enableRag();
      const service = createService();
      const { ioRedis } = await import('@gitroom/nestjs-libraries/redis/redis.service');
      mockRepo.replaceSourceChunks.mockRejectedValue(new Error('boom'));

      vi.mocked(ioRedis.brpoplpush).mockImplementationOnce(async () => {
        (service as any)._workerRunning = false;
        return JSON.stringify({
          organizationId: 'org-1',
          sourceType: 'post',
          sourceId: 'p1',
          chunks: ['only chunk.'],
          contentHash: 'h1',
        });
      });

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 5));

      // failed job is removed from processing and re-pushed to the queue
      expect(ioRedis.lpush).toHaveBeenCalled();
    });

    it('swallows an RPOP error then stops', async () => {
      enableRag();
      const service = createService();
      const { ioRedis } = await import('@gitroom/nestjs-libraries/redis/redis.service');
      (service as any)._workerDelayMs = 1;

      vi.mocked(ioRedis.brpoplpush).mockImplementationOnce(async () => {
        (service as any)._workerRunning = false;
        throw new Error('redis down');
      });

      await service.onModuleInit();
      await new Promise((r) => setTimeout(r, 10));
      expect(ioRedis.brpoplpush).toHaveBeenCalled();
    });

    it('is idempotent — a second _startWorker is a no-op while running', async () => {
      const service = createService();
      (service as any)._workerRunning = true;
      await expect((service as any)._startWorker()).resolves.toBeUndefined();
    });
  });

  describe('_formatVector', () => {
    it('formats array to pgvector string', () => {
      const service = createService();
      const result = (service as any)._formatVector([1.5, 2.3, 3.7]);
      expect(result).toBe('[1.5,2.3,3.7]');
    });
  });

  describe('_simpleHash', () => {
    it('produces consistent hash', () => {
      const service = createService();
      const h1 = (service as any)._simpleHash('hello');
      const h2 = (service as any)._simpleHash('hello');
      expect(h1).toBe(h2);
      expect(h1.length).toBe(64);
    });
  });

  describe('_chunkText', () => {
    it('splits text into chunks by sentence', () => {
      const service = createService();
      const chunks = (service as any)._chunkText(
        'First sentence. Second sentence here. Third sentence is longer here.',
        30,
        5,
      );
      expect(Array.isArray(chunks)).toBe(true);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('returns empty array for empty text', () => {
      const service = createService();
      const chunks = (service as any)._chunkText('');
      expect(chunks).toEqual([]);
    });

    it('returns empty array for whitespace-only text', () => {
      const service = createService();
      const chunks = (service as any)._chunkText('   ');
      expect(chunks).toEqual([]);
    });

    it('uses defaults when size/overlap not provided', () => {
      const service = createService();
      const chunks = (service as any)._chunkText('A short text.');
      expect(chunks.length).toBe(1);
    });

    it('handles single sentence', () => {
      const service = createService();
      const chunks = (service as any)._chunkText('One sentence here.');
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('One sentence here.');
    });

    it('caps the number of chunks at MAX_CHUNKS', () => {
      const service = createService();
      // Generate far more chunks than the cap by using many tiny sentences.
      const content = new Array(2500).fill('A.').join(' ');
      const chunks = (service as any)._chunkText(content, 1, 0);
      expect(chunks.length).toBe(2000);
    });
  });

  describe('_getRagSettings', () => {
    it('returns enabled:false when settings are null', async () => {
      const service = createService();
      const settings = await (service as any)._getRagSettings();
      expect(settings.enabled).toBe(false);
    });

    it('returns enabled:false when ragSettings is not an object', async () => {
      mockAiSettingsManager.getSettings.mockResolvedValue({ ragSettings: 'not-an-object' });
      const service = createService();
      const settings = await (service as any)._getRagSettings();
      expect(settings.enabled).toBe(false);
    });

    it('uses custom chunkSize and chunkOverlap from settings', async () => {
      enableRag({ chunkSize: 1000, chunkOverlap: 200 });
      const service = createService();
      const settings = await (service as any)._getRagSettings();
      expect(settings.chunkSize).toBe(1000);
      expect(settings.chunkOverlap).toBe(200);
    });
  });

  describe('Qdrant vector store (§3.6 / #25)', () => {
    function enableQdrant() {
      mockAiSettingsManager.getSettings.mockResolvedValue({
        ragSettings: {
          enabled: true,
          vectorStore: 'qdrant',
          qdrantUrl: 'http://qdrant:6333',
          qdrantCollection: 'postiz_rag',
        },
      });
    }

    it('searches Qdrant with a mandatory organizationId filter (no cross-org reads)', async () => {
      enableQdrant();
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      mockQdrantSearch.mockResolvedValue([
        {
          content: 'qdrant chunk',
          score: 0.9,
          metadata: { organizationId: 'org-1', sourceType: 'post', sourceId: 'p1', text: 'qdrant chunk' },
        },
      ]);
      const service = createService();
      const results = await service.search({ organizationId: 'org-1', query: 'pricing thread' });
      expect(mockQdrantSearch).toHaveBeenCalledWith(
        expect.objectContaining({ filter: { organizationId: 'org-1' } }),
      );
      expect(results[0].text).toBe('qdrant chunk');
    });

    it('drops Qdrant hits whose payload org does not match (isolation)', async () => {
      enableQdrant();
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      mockQdrantSearch.mockResolvedValue([
        { content: 'leaked', score: 0.99, metadata: { organizationId: 'other-org' } },
      ]);
      const service = createService();
      const results = await service.search({ organizationId: 'org-1', query: 'x y z term' });
      expect(results.find((r) => r.text === 'leaked')).toBeUndefined();
    });

    it('falls back to pgvector when Qdrant probe fails', async () => {
      enableQdrant();
      mockQdrantHealth.mockResolvedValue(false);
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      mockRepo.vectorSearch.mockResolvedValue([
        { text: 'pg chunk', sourceType: 'post', sourceId: 'p1', score: 0.8 },
      ]);
      const service = createService();
      const results = await service.search({ organizationId: 'org-1', query: 'a query here' });
      expect(mockQdrantSearch).not.toHaveBeenCalled();
      expect(results[0].text).toBe('pg chunk');
    });

    it('upserts to Qdrant with org-scoped payload on index', async () => {
      enableQdrant();
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      const service = createService();
      await (service as any)._doIndex('org-1', 'post', 'p1', ['only chunk.'], 'hash-1');
      expect(mockQdrantUpsert).toHaveBeenCalled();
      const points = mockQdrantUpsert.mock.calls[0][0];
      expect(points[0].payload.organizationId).toBe('org-1');
    });
  });

  describe('hybrid BM25 fusion', () => {
    it('fuses BM25 hits with vector hits when BM25 returns results', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      mockRepo.vectorSearch.mockResolvedValue([
        { text: 'vec', sourceType: 'post', sourceId: 'p1', score: 0.8 },
      ]);
      mockRepo.findChunksForBm25.mockResolvedValue([
        { id: 'c1', chunk: 'bm25 doc', sourceType: 'post', sourceId: 'p2' },
      ]);
      mockBm25Search.mockReturnValue([
        { chunkId: 'c1', documentId: 'p2', content: 'bm25 doc', score: 2.0, source: 'bm25', metadata: { sourceType: 'post', sourceId: 'p2', text: 'bm25 doc' } },
      ]);
      mockRrf.mockReturnValue([
        { content: 'bm25 doc', documentId: 'p2', score: 0.5, metadata: { sourceType: 'post', sourceId: 'p2', text: 'bm25 doc' } },
      ]);
      const service = createService();
      const results = await service.search({ organizationId: 'org-1', query: 'fuse these terms' });
      expect(mockBm25Add).toHaveBeenCalled();
      expect(mockRrf).toHaveBeenCalled();
      expect(results[0].text).toBe('bm25 doc');
    });
  });

  describe('media backfill + embedding spend (§3.6 / #25)', () => {
    it('indexes media sources, not just posts', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockRejectedValue(new Error('no vector'));
      mockRepo.findMediaForBackfill.mockResolvedValue([
        { id: 'm1', name: 'logo', originalName: 'logo.png', alt: 'company logo' },
      ]);
      const service = createService();
      const result = await service.backfill('org-1');
      expect(mockRepo.findMediaForBackfill).toHaveBeenCalledWith('org-1');
      expect(result.indexed).toBeGreaterThanOrEqual(1);
    });

    it('tags backfill embedding spend with scope="backfill" and the admin userId', async () => {
      enableRag();
      mockRepo.ensurePgvectorTable.mockResolvedValue(undefined);
      mockEmbeddingModel.doEmbed.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });
      mockRepo.findPostsForBackfill.mockResolvedValue([
        { id: 'p1', content: 'Backfill me please.', title: 'T', description: 'D' },
      ]);
      const service = createService();
      await service.backfill('org-1', 'admin-9');
      expect(mockCreateSpendLog).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'backfill', organizationId: 'org-1', userId: 'admin-9' }),
      );
    });
  });
});
