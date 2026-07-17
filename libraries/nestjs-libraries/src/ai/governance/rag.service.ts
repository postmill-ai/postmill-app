import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiRagRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-rag/ai-rag.repository';
import { AIModelProvider } from '../ai-model.provider';
import { AiSettingsManager } from '../ai-settings.manager';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { PgVectorStoreAdapter } from '../rag/pgvector.adapter';
import { QdrantVectorStoreAdapter } from '../rag/qdrant.adapter';
import { PineconeVectorStoreAdapter } from '../rag/pinecone.adapter';
import { RemotePgVectorStoreAdapter } from '../rag/remote-pgvector.adapter';
import { VectorStoreAdapter } from '../rag/vector-store.adapter';

export type VectorStoreKind = 'pgvector' | 'pgvector-remote' | 'qdrant' | 'pinecone';

export interface RagSettings {
  enabled: boolean;
  embeddingDimension?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  // Pluggable vector store. 'pgvector' = the built-in Postmill default (app DB);
  // the others are remote stores configured per-deployment.
  vectorStore?: VectorStoreKind;
  // Qdrant (remote)
  qdrantUrl?: string;
  qdrantCollection?: string;
  qdrantApiKey?: string;
  distance?: 'Cosine' | 'Euclid' | 'Dot';
  // Remote pgvector (external Postgres) — pgUrl is a secret (carries the password)
  pgUrl?: string;
  pgTable?: string;
  // Pinecone (remote) — pineconeApiKey is a secret
  pineconeApiKey?: string;
  pineconeIndex?: string;
  pineconeHost?: string;
}

const EXTERNAL_STORES: VectorStoreKind[] = ['qdrant', 'pgvector-remote', 'pinecone'];

const isExternalStore = (v?: string): v is VectorStoreKind =>
  EXTERNAL_STORES.includes(v as VectorStoreKind);

const DEFAULT_EMBEDDING_DIMENSION = 1536;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 100;
const MAX_CHUNKS = 2000;
const BACKFILL_BATCH_SIZE = 20;
const SEARCH_DEFAULT_LIMIT = 5;

interface RagHit {
  text: string;
  sourceType: string;
  sourceId: string;
  score: number;
}

@Injectable()
export class RagService implements OnModuleInit, OnModuleDestroy {
  private _logger = new Logger(RagService.name);
  private _sideTableInitialized = false;
  private _sideTableDimension: number | null = null;

  constructor(
    private _aiSettings: AiSettingsService,
    private _aiRagRepository: AiRagRepository,
    private _aiModelProvider: AIModelProvider,
    private _aiSettingsManager: AiSettingsManager,
    private _pgVectorAdapter: PgVectorStoreAdapter,
  ) {}

  private _ragSettingsCache: { value: RagSettings; expiry: number } | null = null;
  private readonly _ragCacheTtlMs = 30_000;

  private async _getRagSettings(): Promise<RagSettings> {
    if (this._ragSettingsCache && Date.now() < this._ragSettingsCache.expiry) {
      return this._ragSettingsCache.value;
    }
    const settings = await this._aiSettingsManager.getSettings();
    const raw = settings?.ragSettings;
    let result: RagSettings;
    if (raw && typeof raw === 'object' && typeof raw.enabled === 'boolean') {
      const secret = (settings as any)?.secretSettings || {};
      const vectorStore: VectorStoreKind = [
        'pgvector',
        'pgvector-remote',
        'qdrant',
        'pinecone',
      ].includes(raw.vectorStore)
        ? raw.vectorStore
        : 'pgvector';
      result = {
        enabled: raw.enabled,
        embeddingDimension: typeof raw.embeddingDimension === 'number' ? raw.embeddingDimension : undefined,
        chunkSize: typeof raw.chunkSize === 'number' ? raw.chunkSize : undefined,
        chunkOverlap: typeof raw.chunkOverlap === 'number' ? raw.chunkOverlap : undefined,
        vectorStore,
        qdrantUrl: typeof raw.qdrantUrl === 'string' ? raw.qdrantUrl : undefined,
        qdrantCollection: typeof raw.qdrantCollection === 'string' ? raw.qdrantCollection : undefined,
        // Secrets come from the decrypted secretSettings blob (fall back to any
        // legacy plaintext value still living in ragSettings).
        qdrantApiKey: secret.qdrantApiKey ?? (typeof raw.qdrantApiKey === 'string' ? raw.qdrantApiKey : undefined),
        pgUrl: secret.pgUrl ?? (typeof raw.pgUrl === 'string' ? raw.pgUrl : undefined),
        pgTable: typeof raw.pgTable === 'string' ? raw.pgTable : undefined,
        pineconeApiKey: secret.pineconeApiKey ?? (typeof raw.pineconeApiKey === 'string' ? raw.pineconeApiKey : undefined),
        pineconeIndex: typeof raw.pineconeIndex === 'string' ? raw.pineconeIndex : undefined,
        pineconeHost: typeof raw.pineconeHost === 'string' ? raw.pineconeHost : undefined,
      };
    } else {
      result = { enabled: false };
    }
    this._ragSettingsCache = { value: result, expiry: Date.now() + this._ragCacheTtlMs };
    return result;
  }

  private async _getEmbeddingDimension(): Promise<number> {
    const rag = await this._getRagSettings();
    return rag.embeddingDimension || DEFAULT_EMBEDDING_DIMENSION;
  }

  async _ensureSideTable(): Promise<{ pgvectorAvailable: boolean; dimension: number }> {
    const dimension = await this._getEmbeddingDimension();

    if (this._sideTableInitialized && this._sideTableDimension === dimension) {
      return { pgvectorAvailable: true, dimension };
    }

    try {
      await this._aiRagRepository.ensurePgvectorTable(dimension);

      this._sideTableInitialized = true;
      this._sideTableDimension = dimension;

      return { pgvectorAvailable: true, dimension };
    } catch (err) {
      this._logger.warn('pgvector side table unavailable, falling back to text search: ' + (err as Error).message);
      this._sideTableInitialized = true;
      this._sideTableDimension = dimension;
      return { pgvectorAvailable: false, dimension };
    }
  }

  private _chunkText(text: string, chunkSize?: number, chunkOverlap?: number): string[] {
    const maxLen = chunkSize || DEFAULT_CHUNK_SIZE;
    const overlap = chunkOverlap || DEFAULT_CHUNK_OVERLAP;

    if (!text || text.trim().length === 0) return [];

    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (chunks.length >= MAX_CHUNKS) {
        break;
      }
      if (current.length + sentence.length + 1 > maxLen && current.length > 0) {
        chunks.push(current.trim());
        const overlapStart = Math.max(0, current.length - overlap);
        current = current.slice(overlapStart).trim();
      }
      current += (current ? ' ' : '') + sentence;
    }

    if (current.trim().length > 0 && chunks.length < MAX_CHUNKS) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  async indexContent(params: {
    organizationId: string;
    sourceType: string;
    sourceId: string;
    content: string;
  }): Promise<void> {
    const enabled = await this._isRagEnabled();
    if (!enabled) {
      throw new Error('RAG is not enabled for this organization');
    }

    if (!params.organizationId || !params.sourceType || !params.sourceId || !params.content) {
      throw new Error('indexContent requires organizationId, sourceType, sourceId, and content');
    }

    const ragSettings = await this._getRagSettings();

    const chunks = this._chunkText(params.content, ragSettings.chunkSize, ragSettings.chunkOverlap);
    if (chunks.length === 0) return;

    const allContent = chunks.join('\n---CHUNK---\n');
    const contentHash = this._simpleHash(allContent);

    const existing = await this._aiRagRepository.findContentHash(
      params.organizationId,
      params.sourceType,
      params.sourceId,
    );

    if (existing && existing.contentHash === contentHash) {
      this._logger.debug(`Content unchanged for ${params.sourceType}:${params.sourceId}, skipping re-index`);
      return;
    }

    // Durable Redis-backed queue replaces the old setImmediate fire-and-forget.
    // Items are LPUSHed into rag:index:queue; a background BRPOP worker drains
    // them. If Redis is unavailable the caller falls back to setImmediate so a
    // publish path is never blocked — the backfill() is the durable backstop
    // for any missed items.
    try {
      const queueItem = JSON.stringify({
        organizationId: params.organizationId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        chunks,
        contentHash,
      });
      await ioRedis.lpush('rag:index:queue', queueItem);
    } catch {
      setImmediate(async () => {
        try {
          await this._doIndex(params.organizationId, params.sourceType, params.sourceId, chunks, contentHash);
        } catch (err) {
          this._logger.error(
            `Failed to index ${params.sourceType}:${params.sourceId}: ${(err as Error).message}`,
          );
        }
      });
    }
  }

  private async _doIndex(
    organizationId: string,
    sourceType: string,
    sourceId: string,
    chunks: string[],
    contentHash: string,
    scope: string = 'utility',
    userId?: string,
  ): Promise<void> {
    const store = await this._resolveStore();
    const useExternal = store.kind === 'external';

    const { pgvectorAvailable } = useExternal
      ? { pgvectorAvailable: false }
      : await this._ensureSideTable();

    let embeddings: number[][] = [];
    if (pgvectorAvailable || useExternal) {
      embeddings = await this._computeEmbeddings(chunks, organizationId, scope, userId);
    }

    const created = await this._aiRagRepository.replaceSourceChunks({
      organizationId,
      sourceType,
      sourceId,
      contentHash,
      chunks,
      embeddings,
      pgvectorAvailable,
      formatVector: (arr) => this._formatVector(arr),
    });

    if (useExternal && embeddings.length === created.length) {
      const points = created
        .map((idx, i) => ({
          id: idx.id,
          vector: embeddings[i],
          text: idx.chunk,
          sourceType,
          sourceId,
        }))
        .filter((p) => Array.isArray(p.vector) && p.vector.length > 0);
      await store.adapter.upsertBatch(organizationId, points);
    }

    this._logger.log(
      `Indexed ${chunks.length} chunks for ${sourceType}:${sourceId}`,
    );
  }

  private async _computeEmbeddings(
    chunks: string[],
    organizationId: string,
    scope: string = 'utility',
    userId?: string,
  ): Promise<number[][]> {
    try {
      const model = await this._aiModelProvider.embeddingModel('utility', organizationId);
      if (!model) {
        this._logger.warn('No embedding model available, skipping embedding computation');
        return [];
      }

      const batchSize = 20;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const result = await (model as any).doEmbed({ values: batch });

        if (result?.embeddings && Array.isArray(result.embeddings)) {
          for (const emb of result.embeddings) {
            if (Array.isArray(emb)) {
              allEmbeddings.push(emb as number[]);
            }
          }
        }
      }

      // §3.6/#25/#16 — spend-tag embedding usage. Backfill spend is recorded with
      // scope='backfill' (exempt from the interactive hard cap by BudgetService) and
      // attributed to the initiating admin (userId). Best-effort: a failed ledger write
      // must never fail indexing.
      await this._recordEmbeddingSpend(chunks, organizationId, scope, userId, allEmbeddings.length);

      return allEmbeddings;
    } catch (err) {
      this._logger.warn(`Failed to compute embeddings: ${(err as Error).message}`);
      return [];
    }
  }

  private async _recordEmbeddingSpend(
    chunks: string[],
    organizationId: string,
    scope: string,
    userId: string | undefined,
    embeddedCount: number,
  ): Promise<void> {
    if (embeddedCount === 0) return;
    const createSpendLog = (this._aiSettings as any)?.createSpendLog;
    if (typeof createSpendLog !== 'function') return;
    try {
      const rag = await this._getRagSettings();
      const tokens = chunks.reduce((sum, c) => sum + Math.ceil((c?.length ?? 0) / 4), 0);
      // Embedding pricing ~ $0.00002 / 1k tokens (text-embedding-3-small order of magnitude).
      const costUsd = (tokens / 1000) * 0.00002;
      await createSpendLog.call(this._aiSettings, {
        organizationId,
        userId,
        provider: 'embedding',
        model: rag.embeddingDimension ? `embedding-${rag.embeddingDimension}` : 'embedding',
        scope,
        inputTokens: tokens,
        outputTokens: 0,
        costUsd,
      });
    } catch (err) {
      this._logger.warn(`Embedding spend tagging failed: ${(err as Error).message}`);
    }
  }

  private _formatVector(arr: number[]): string {
    return '[' + arr.join(',') + ']';
  }

  private _externalAdapter: VectorStoreAdapter | null = null;
  private _externalKey: string | null = null;
  private _externalProbed: boolean | null = null;

  // Build the configured remote adapter, or null when its required settings are
  // missing. Returns null for the built-in pgvector default.
  private _buildExternalAdapter(rag: RagSettings): VectorStoreAdapter | null {
    const dimension = rag.embeddingDimension || DEFAULT_EMBEDDING_DIMENSION;
    if (rag.vectorStore === 'qdrant' && rag.qdrantUrl) {
      return new QdrantVectorStoreAdapter({
        url: rag.qdrantUrl,
        apiKey: rag.qdrantApiKey,
        collectionName: rag.qdrantCollection || 'postiz_rag',
        dimension,
        distance: rag.distance || 'Cosine',
      });
    }
    if (rag.vectorStore === 'pgvector-remote' && rag.pgUrl) {
      return new RemotePgVectorStoreAdapter({
        connectionString: rag.pgUrl,
        table: rag.pgTable,
        dimension,
      });
    }
    if (rag.vectorStore === 'pinecone' && rag.pineconeApiKey && (rag.pineconeHost || rag.pineconeIndex)) {
      return new PineconeVectorStoreAdapter({
        apiKey: rag.pineconeApiKey,
        host: rag.pineconeHost,
        indexName: rag.pineconeIndex,
        dimension,
      });
    }
    return null;
  }

  // A signature over the settings that affect adapter construction, so the cached
  // adapter (and its pooled connections) is rebuilt only when config changes.
  private _externalSignature(rag: RagSettings): string {
    return JSON.stringify({
      vs: rag.vectorStore,
      d: rag.embeddingDimension,
      qu: rag.qdrantUrl,
      qc: rag.qdrantCollection,
      qk: rag.qdrantApiKey ? 1 : 0,
      pg: rag.pgUrl ? 1 : 0,
      pt: rag.pgTable,
      pk: rag.pineconeApiKey ? 1 : 0,
      pi: rag.pineconeIndex,
      ph: rag.pineconeHost,
    });
  }

  private async _resolveStore(): Promise<{
    kind: 'local' | 'external';
    adapter: VectorStoreAdapter;
  }> {
    const rag = await this._getRagSettings();
    if (!isExternalStore(rag.vectorStore)) {
      return { kind: 'local', adapter: this._pgVectorAdapter };
    }

    const signature = this._externalSignature(rag);
    if (this._externalKey !== signature) {
      // Settings changed — tear down the previous pool (remote pgvector) and rebuild.
      void this._externalAdapter?.close?.();
      this._externalAdapter = this._buildExternalAdapter(rag);
      this._externalKey = signature;
      this._externalProbed = null;
    }

    if (!this._externalAdapter) {
      return { kind: 'local', adapter: this._pgVectorAdapter };
    }

    try {
      if (this._externalProbed === null) {
        this._externalProbed = await this._externalAdapter.probe();
      }
      if (this._externalProbed) {
        return { kind: 'external', adapter: this._externalAdapter };
      }
      this._logger.warn(`${rag.vectorStore} selected but unreachable — falling back to pgvector/text`);
    } catch (err) {
      this._logger.warn(`${rag.vectorStore} store resolution failed: ` + (err as Error).message);
    }
    return { kind: 'local', adapter: this._pgVectorAdapter };
  }

  // §3.6 — BM25 (Okapi) arm fused with the vector arm via reciprocal-rank fusion
  // (@reaatech/hybrid-rag-retrieval). Org-scoped: BM25 only ever sees this org's chunk
  // rows. Returns null when the library is unavailable or there are no BM25 hits, so the
  // caller keeps its vector-only / text-only result unchanged (no regression).
  private async _bm25Fuse(
    organizationId: string,
    query: string,
    vectorHits: RagHit[],
    limit: number,
  ): Promise<RagHit[] | null> {
    try {
      const rows = await this._aiRagRepository.findChunksForBm25(organizationId);
      if (!rows.length) return null;

      const { BM25Engine, reciprocalRankFusion } = await import('@reaatech/hybrid-rag-retrieval');
      const engine = new BM25Engine();
      engine.addDocuments(
        rows.map((r) => ({
          id: r.id,
          content: r.chunk || '',
          metadata: { sourceType: r.sourceType, sourceId: r.sourceId, text: r.chunk || '' },
        })),
      );
      const bm25 = engine.search(query, limit);
      if (!bm25.length) return null;

      const vectorResults = vectorHits.map((h, i) => ({
        chunkId: `v-${i}`,
        documentId: h.sourceId,
        content: h.text,
        score: h.score,
        source: 'vector' as const,
        metadata: { sourceType: h.sourceType, sourceId: h.sourceId, text: h.text },
      }));

      const fused: any[] = reciprocalRankFusion(vectorResults as any, bm25 as any);
      return fused.slice(0, limit).map((r) => ({
        text: String(r?.content ?? r?.metadata?.text ?? ''),
        sourceType: String(r?.metadata?.sourceType ?? ''),
        sourceId: String(r?.metadata?.sourceId ?? r?.documentId ?? ''),
        score: typeof r?.score === 'number' ? r.score : 0,
      }));
    } catch (err) {
      this._logger.warn('BM25 fusion unavailable, using vector-only results: ' + (err as Error).message);
      return null;
    }
  }

  async search(
    params: { organizationId: string; query: string; limit?: number },
  ): Promise<{ text: string; sourceType: string; sourceId: string; score: number }[]> {
    const enabled = await this._isRagEnabled();
    if (!enabled) {
      throw new Error('RAG is not enabled for this organization');
    }

    if (!params.organizationId || !params.query) {
      throw new Error('search requires organizationId and query');
    }

    const limit = params.limit || SEARCH_DEFAULT_LIMIT;

    const store = await this._resolveStore();

    if (store.kind === 'external') {
      try {
        const embeddings = await this._computeEmbeddings([params.query], params.organizationId);
        if (embeddings.length && embeddings[0]?.length) {
          const vectorHits = await store.adapter.search(params.organizationId, embeddings[0], limit);
          const fused = await this._bm25Fuse(params.organizationId, params.query, vectorHits, limit);
          return fused ?? vectorHits;
        }
      } catch (err) {
        this._logger.warn('Remote vector search failed, falling back to text: ' + (err as Error).message);
      }
      return this._textSearch(params.organizationId, params.query, limit);
    }

    const { pgvectorAvailable } = await this._ensureSideTable();

    if (pgvectorAvailable) {
      const vectorHits = await this._vectorSearch(params.organizationId, params.query, limit);
      const fused = await this._bm25Fuse(params.organizationId, params.query, vectorHits, limit);
      return fused ?? vectorHits;
    }

    return this._textSearch(params.organizationId, params.query, limit);
  }

  private async _vectorSearch(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<{ text: string; sourceType: string; sourceId: string; score: number }[]> {
    try {
      const embeddings = await this._computeEmbeddings([query], organizationId);
      if (!embeddings.length || !embeddings[0] || embeddings[0].length === 0) {
        return this._textSearch(organizationId, query, limit);
      }

      const queryVector = this._formatVector(embeddings[0]);

      return await this._aiRagRepository.vectorSearch(organizationId, queryVector, limit);
    } catch (err) {
      this._logger.warn(`Vector search failed, falling back to text: ${(err as Error).message}`);
      return this._textSearch(organizationId, query, limit);
    }
  }

  private async _textSearch(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<{ text: string; sourceType: string; sourceId: string; score: number }[]> {
    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 5);

    if (terms.length === 0) {
      return this._aiRagRepository.textSearchRecent(organizationId, limit);
    }

    return this._aiRagRepository.textSearchTerms(organizationId, terms, limit);
  }

  async backfill(organizationId?: string, userId?: string): Promise<{ indexed: number }> {
    const enabled = await this._isRagEnabled();
    if (!enabled) {
      throw new Error('RAG is not enabled for this organization');
    }

    if (!organizationId) {
      throw new Error('backfill requires a valid organizationId');
    }

    let indexed = 0;

    const posts = await this._aiRagRepository.findPostsForBackfill(organizationId);

    for (let i = 0; i < posts.length; i += BACKFILL_BATCH_SIZE) {
      const batch = posts.slice(i, i + BACKFILL_BATCH_SIZE);
      for (const post of batch) {
        const content = [post.title, post.description, post.content].filter(Boolean).join('\n\n');
        indexed += await this._backfillOne(organizationId, 'post', post.id, content, userId);
      }
      this._logger.log(`Backfill: indexed ${Math.min(i + BACKFILL_BATCH_SIZE, posts.length)}/${posts.length} posts`);
    }

    // §3.6 — also walk the org's media (alt-text / name) so semantic search covers the
    // media library, not just posts. Same batched + idempotent (contentHash) path.
    const media = await this._aiRagRepository.findMediaForBackfill(organizationId);

    for (let i = 0; i < media.length; i += BACKFILL_BATCH_SIZE) {
      const batch = media.slice(i, i + BACKFILL_BATCH_SIZE);
      for (const m of batch) {
        const content = [m.alt, m.name, m.originalName].filter(Boolean).join('\n\n');
        indexed += await this._backfillOne(organizationId, 'media', m.id, content, userId);
      }
      this._logger.log(`Backfill: indexed ${Math.min(i + BACKFILL_BATCH_SIZE, media.length)}/${media.length} media`);
    }

    return { indexed };
  }

  // Indexes one source for backfill: skips empties, skips unchanged content (contentHash),
  // and tags embedding spend with scope='backfill' + the initiating admin (userId).
  private async _backfillOne(
    organizationId: string,
    sourceType: string,
    sourceId: string,
    content: string,
    userId?: string,
  ): Promise<number> {
    if (!content || !content.trim()) return 0;

    const chunks = this._chunkText(content);
    if (chunks.length === 0) return 0;

    const allContent = chunks.join('\n---CHUNK---\n');
    const contentHash = this._simpleHash(allContent);

    const existing = await this._aiRagRepository.findContentHash(
      organizationId,
      sourceType,
      sourceId,
    );

    if (existing && existing.contentHash === contentHash) return 0;

    await this._doIndex(organizationId, sourceType, sourceId, chunks, contentHash, 'backfill', userId);
    return 1;
  }

  async testConnection(settings: RagSettings): Promise<{ ok: boolean; error?: string }> {
    if (isExternalStore(settings.vectorStore)) {
      // Required-field guards with friendly messages before probing.
      if (settings.vectorStore === 'qdrant' && !settings.qdrantUrl) {
        return { ok: false, error: 'Qdrant URL is required' };
      }
      if (settings.vectorStore === 'pgvector-remote' && !settings.pgUrl) {
        return { ok: false, error: 'PostgreSQL connection string is required' };
      }
      if (
        settings.vectorStore === 'pinecone' &&
        (!settings.pineconeApiKey || !(settings.pineconeHost || settings.pineconeIndex))
      ) {
        return { ok: false, error: 'Pinecone API key and index (or host) are required' };
      }
      const adapter = this._buildExternalAdapter(settings);
      if (!adapter) {
        return { ok: false, error: 'Missing required settings for the selected store' };
      }
      try {
        const ok = await adapter.probe();
        return ok ? { ok: true } : { ok: false, error: 'Vector store unreachable' };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      } finally {
        // Tear down any transient pool (remote pgvector) opened for the probe.
        void adapter.close?.();
      }
    }

    const ok = await this._pgVectorAdapter.probe();
    return ok
      ? { ok: true }
      : { ok: false, error: 'pgvector extension is not available in PostgreSQL' };
  }

  async onModuleInit(): Promise<void> {
    this._startWorker();
  }

  async onModuleDestroy(): Promise<void> {
    this._workerRunning = false;
    // Closing the duplicate client unblocks any in-flight BRPOP so the worker
    // loop can exit instead of hanging on shutdown.
    try {
      await this._workerRedis.quit();
    } catch {
      // Ignore shutdown races.
    }
    try {
      await this._workerPromise;
    } catch {
      // Ignore worker errors during shutdown.
    }
  }

  private _workerRunning = false;
  private _workerDelayMs = 2000;
  private readonly _QUEUE_KEY = 'rag:index:queue';
  private readonly _PROCESSING_KEY = 'rag:index:processing';
  private readonly _workerRedis = ioRedis.duplicate();
  private _workerPromise?: Promise<void>;

  private async _startWorker(): Promise<void> {
    if (this._workerRunning) return;
    this._workerRunning = true;

    // Drain the queue on a dedicated duplicate Redis client using a blocking
    // list command. This removes the tight non-blocking poll loop on the shared
    // ioRedis client that could stall pipelined commands such as the throttler.
    this._workerPromise = this._runWorker().catch((err) => {
      this._logger.error(`RAG worker crashed: ${err.message}`);
      this._workerRunning = false;
      setTimeout(() => this._startWorker(), 10_000);
    });
  }

  private async _runWorker(): Promise<void> {
    while (this._workerRunning) {
      let item: string | null = null;
      try {
        item = await this._workerRedis.brpoplpush(
          this._QUEUE_KEY,
          this._PROCESSING_KEY,
          5,
        );
      } catch (err) {
        if (!this._workerRunning) return;
        this._logger.error(
          `RAG worker Redis error: ${(err as Error).message}`,
        );
        await new Promise((r) => setTimeout(r, this._workerDelayMs));
        continue;
      }

      if (!item) {
        // Timeout expired with no work; loop back and check _workerRunning.
        continue;
      }

      const job = JSON.parse(item);
      try {
        await this._doIndex(
          job.organizationId,
          job.sourceType,
          job.sourceId,
          job.chunks,
          job.contentHash,
        );
        await this._workerRedis.lrem(this._PROCESSING_KEY, 1, item);
      } catch (err) {
        this._logger.error(
          `RAG worker failed for ${job.sourceType}:${job.sourceId}: ${(err as Error).message}`,
        );
        await this._workerRedis.lrem(this._PROCESSING_KEY, 1, item);
        await this._workerRedis.lpush(this._QUEUE_KEY, item);
      }
    }
  }

  enqueueIndexJob(params: {
    organizationId: string;
    sourceType: string;
    sourceId: string;
    content: string;
  }): void {
    this.indexContent(params).catch((err) => {
      this._logger.error(
        `[RAG] indexContent failed for ${params.sourceType}:${params.sourceId}`,
        { error: (err as Error).message },
      );
    });
  }

  private _simpleHash(str: string): string {
    return createHash('sha256').update(str).digest('hex');
  }

  private async _isRagEnabled(): Promise<boolean> {
    const ragSettings = await this._getRagSettings();
    return ragSettings.enabled;
  }

  /**
   * Indexes the org's top-performing posts into RAG so the "write like our best
   * posts" feature can retrieve them by semantic similarity. Returns the number
   * of newly indexed sources.
   */
  async indexTopPerformingPosts(
    organizationId: string,
    limit: number = 10,
    userId?: string,
  ): Promise<{ indexed: number }> {
    const enabled = await this._isRagEnabled();
    if (!enabled) {
      throw new Error('RAG is not enabled for this organization');
    }

    const posts = await this._aiRagRepository.findTopPerformingPosts(organizationId, limit);
    let indexed = 0;

    for (const post of posts) {
      const content = [post.title, post.description, post.content].filter(Boolean).join('\n\n');
      if (!content.trim()) continue;

      const chunks = this._chunkText(content);
      if (chunks.length === 0) continue;

      const allContent = chunks.join('\n---CHUNK---\n');
      const contentHash = this._simpleHash(allContent);

      const existing = await this._aiRagRepository.findContentHash(
        organizationId,
        'brand_memory',
        post.id,
      );

      if (existing && existing.contentHash === contentHash) continue;

      await this._doIndex(organizationId, 'brand_memory', post.id, chunks, contentHash, 'brand_memory', userId);
      indexed++;
    }

    return { indexed };
  }

  /**
   * Performs a RAG search scoped to "brand_memory" sources — the org's
   * top-performing post content. Used by the "write like our best posts"
   * feature to retrieve relevant snippets.
   */
  async searchBrandMemory(
    organizationId: string,
    query: string,
    limit: number = 5,
  ): Promise<{ text: string; sourceType: string; sourceId: string; score: number }[]> {
    const enabled = await this._isRagEnabled();
    if (!enabled) {
      throw new Error('RAG is not enabled for this organization');
    }

    if (!organizationId || !query) {
      throw new Error('searchBrandMemory requires organizationId and query');
    }

    const allResults = await this.search({ organizationId, query, limit: limit * 3 });

    return allResults
      .filter((r) => r.sourceType === 'brand_memory')
      .slice(0, limit);
  }

  async getStatus(organizationId: string): Promise<{
    enabled: boolean;
    indexedItems: number;
    lastIndexed: string | null;
    embeddingModel: string;
    vectorStore: string;
  }> {
    if (!organizationId) {
      throw new Error('getStatus requires a valid organizationId');
    }

    const enabled = await this._isRagEnabled();

    let indexedItems = 0;
    let lastIndexed: string | null = null;
    if (enabled) {
      const entries = await this._aiRagRepository.getOrgContentIndexEntries(organizationId);
      indexedItems = entries.length;
      if (entries.length > 0) {
        lastIndexed = entries.reduce((latest, e) =>
          new Date(e.updatedAt) > new Date(latest.updatedAt) ? e : latest,
        ).updatedAt.toISOString();
      }
    }

    const settings = await this._aiSettingsManager.getSettings();
    const rag = settings?.ragSettings as any;
    const scopeModels = settings?.scopeModels as any;
    const utilityModel = scopeModels?.utility;
    const activeProvider = settings?.activeProvider || 'openai';
    const activeModel =
      rag?.embeddingModel ||
      utilityModel?.model ||
      settings?.activeModel ||
      'text-embedding-3-small';

    return {
      enabled,
      indexedItems,
      lastIndexed,
      embeddingModel: `${activeProvider}/${activeModel}`,
      vectorStore: rag?.vectorStore || 'pgvector',
    };
  }

  async getItems(
    organizationId: string,
    params: { sourceType?: string; limit?: number; offset?: number },
  ): Promise<{
    items: Array<{ sourceId: string; sourceType: string; indexedDate: string; chunkCount: number; charCount: number }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    if (!organizationId) {
      throw new Error('getItems requires a valid organizationId');
    }

    const parsedOffset = Math.max(0, params.offset ?? 0);
    const parsedLimit = Math.min(100, Math.max(1, params.limit ?? 20));

    const entries = await this._aiRagRepository.getOrgContentIndexEntries(organizationId);

    const filtered = params.sourceType
      ? entries.filter((e) => e.sourceType === params.sourceType)
      : entries;

    const grouped = new Map<
      string,
      { sourceId: string; sourceType: string; indexedDate: string; chunkCount: number; charCount: number }
    >();

    for (const entry of filtered) {
      const key = `${entry.sourceType}:${entry.sourceId}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          sourceId: entry.sourceId,
          sourceType: entry.sourceType,
          indexedDate: entry.createdAt.toISOString(),
          chunkCount: 0,
          charCount: 0,
        });
      }
      const group = grouped.get(key)!;
      group.chunkCount++;
      group.charCount += entry.chunk?.length || 0;
      if (new Date(entry.createdAt) > new Date(group.indexedDate)) {
        group.indexedDate = entry.createdAt.toISOString();
      }
    }

    const items = Array.from(grouped.values());
    const total = items.length;
    const paged = items.slice(parsedOffset, parsedOffset + parsedLimit);

    return { items: paged, total, offset: parsedOffset, limit: parsedLimit };
  }

  async deleteItem(organizationId: string, sourceType: string, sourceId: string): Promise<void> {
    await this._aiRagRepository.deleteContentIndexEntries(organizationId, sourceType, sourceId);
  }
}
