import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

// Hard cap on chunks indexed for a single source. Chunks are already capped
// upstream in RagService._chunkText; this bounds the per-source insert loop so an
// oversized array can never drive unbounded DB writes inside one transaction.
const MAX_INDEX_CHUNKS = 5000;

interface RagRow {
  text: string;
  sourceType: string;
  sourceId: string;
  score: number;
}

/**
 * Repository for the RAG (retrieval-augmented generation) data layer.
 *
 * Per CLAUDE.md (Controller → Service → Repository), ALL Prisma access and raw
 * SQL for RAG lives here — the service (`RagService`) never issues raw SQL. This
 * includes the out-of-band `AIContentEmbedding` pgvector side table, which is
 * created/queried via raw SQL (§3.6) because it is not a Prisma model.
 *
 * `PrismaRepository.model` is the underlying PrismaService instance at runtime,
 * so it exposes both the typed `aIContentIndex` model and the raw
 * `$executeRawUnsafe` / `$queryRawUnsafe` / $transaction methods. Raw methods
 * are reached through a narrow cast since `model` is typed as a `Pick`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PARAMETERIZATION INVARIANT (3W):
 * Only integer-validated values may be directly interpolated into RAG SQL
 * (`vector(${dimension})`, `${terms.length}::float`). All other inputs must be
 * bound parameters ($1..$n). The runtime assertions in `ensurePgvectorTable`
 * and `textSearchTerms` enforce that interpolated values are positive integers.
 * ════════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class AiRagRepository {
  constructor(private _aiContentIndex: PrismaRepository<'aIContentIndex'>) {}

  // Raw client (PrismaService) for $executeRawUnsafe/$queryRawUnsafe/$transaction.
  private get _raw(): any {
    return this._aiContentIndex.model as any;
  }

  /**
   * Idempotently provisions the out-of-band pgvector side table + HNSW index for
   * the given embedding dimension. Throws if pgvector / DDL is unavailable so the
   * caller can fall back to text search.
   *
   * SAFETY: `dimension` is interpolated into DDL (`vector(${dimension})`) because
   * it cannot be a bound parameter. It MUST be validated as a positive integer
   * before reaching this method — assertions below enforce this at runtime.
   */
  async ensurePgvectorTable(dimension: number): Promise<void> {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new Error(`Invalid pgvector dimension: ${dimension} — must be a positive integer`);
    }
    await this._raw.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

    await this._raw.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AIContentEmbedding" (
          "contentIndexId" text PRIMARY KEY REFERENCES "AIContentIndex"(id) ON DELETE CASCADE,
          "organizationId" text NOT NULL,
          "embedding" vector(${dimension}) NOT NULL
        )
      `);

    await this._raw.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_ai_content_embedding_org ON "AIContentEmbedding"("organizationId")
      `);

    await this._raw.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_ai_content_embedding_hnsw ON "AIContentEmbedding"
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 200)
      `);
  }

  /**
   * Returns the contentHash of an existing chunk row for the source (or null).
   * Used by the content-hash skip-gate before re-indexing.
   */
  findContentHash(
    organizationId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<{ contentHash: string } | null> {
    return this._aiContentIndex.model.aIContentIndex.findFirst({
      where: { organizationId, sourceType, sourceId },
      select: { contentHash: true },
    }) as any;
  }

  /**
   * Atomically replaces a source's chunk rows and (when pgvector is available)
   * upserts their embeddings on the SAME transaction client.
   *
   * Order preserved exactly: deleteMany → create N rows → raw embedding upserts
   * (skipping empty embeddings) — all inside a single `$transaction`. Returns the
   * created chunk rows so the caller can perform the post-commit Qdrant upsert.
   */
  async replaceSourceChunks(params: {
    organizationId: string;
    sourceType: string;
    sourceId: string;
    contentHash: string;
    chunks: string[];
    embeddings: number[][];
    pgvectorAvailable: boolean;
    formatVector: (arr: number[]) => string;
  }): Promise<Array<{ id: string; chunkIndex: number; chunk: string }>> {
    const {
      organizationId,
      sourceType,
      sourceId,
      contentHash,
      chunks,
      embeddings,
      pgvectorAvailable,
      formatVector,
    } = params;

    if (chunks.length > MAX_INDEX_CHUNKS) {
      throw new Error('Too many chunks for a single source');
    }

    return this._raw.$transaction(async (tx: any) => {
      await tx.aIContentIndex.deleteMany({
        where: { organizationId, sourceType, sourceId },
      });

      const indices: Array<{ id: string; chunkIndex: number; chunk: string }> = [];

      // Loop bound is the literal constant MAX_INDEX_CHUNKS (not chunks.length),
      // so iteration count can never be driven by user-influenced input; break once
      // the real chunks are exhausted. (CodeQL js/loop-bound-injection is not
      // satisfied by a preceding throw-guard or by slicing, which preserve taint.)
      for (let i = 0; i < MAX_INDEX_CHUNKS; i++) {
        const chunk = chunks[i];
        if (chunk === undefined) break;
        const record = await tx.aIContentIndex.create({
          data: {
            organizationId,
            sourceType,
            sourceId,
            chunkIndex: i,
            contentHash,
            chunk,
          },
        });
        indices.push({ id: record.id, chunkIndex: i, chunk });
      }

      if (pgvectorAvailable && embeddings.length === indices.length) {
        for (let i = 0; i < indices.length; i++) {
          const emb = embeddings[i];
          if (!emb || emb.length === 0) continue;

          const vectorStr = formatVector(emb);
          await tx.$executeRawUnsafe(
            `INSERT INTO "AIContentEmbedding" ("contentIndexId", "organizationId", "embedding") VALUES ($1, $2, $3::vector) ON CONFLICT ("contentIndexId") DO UPDATE SET "embedding" = $3::vector`,
            indices[i].id,
            organizationId,
            vectorStr,
          );
        }
      }

      return indices;
    });
  }

  /**
   * Fetches a bounded set of an org's chunk rows for the BM25 (lexical) arm of
   * hybrid retrieval. Org-scoped — only ever sees this org's rows.
   */
  findChunksForBm25(
    organizationId: string,
  ): Promise<Array<{ id: string; chunk: string | null; sourceType: string; sourceId: string }>> {
    return this._aiContentIndex.model.aIContentIndex.findMany({
      where: { organizationId, chunk: { not: null } },
      select: { id: true, chunk: true, sourceType: true, sourceId: true },
      take: 500,
    }) as any;
  }

  /**
   * Vector (cosine) search over the pgvector side table, org-scoped. Returns
   * normalized hits ordered by cosine distance ascending (closest first).
   */
  async vectorSearch(
    organizationId: string,
    queryVector: string,
    limit: number,
  ): Promise<RagRow[]> {
    const rows = (await this._raw.$queryRawUnsafe(
      `SELECT
          ci.chunk AS text,
          ci."sourceType" AS "sourceType",
          ci."sourceId" AS "sourceId",
          (1 - (e.embedding <=> $1::vector)) AS score
        FROM "AIContentEmbedding" e
        JOIN "AIContentIndex" ci ON ci.id = e."contentIndexId"
        WHERE e."organizationId" = $2
          AND ci.chunk IS NOT NULL
          AND ci.chunk != ''
        ORDER BY e.embedding <=> $1::vector
        LIMIT $3`,
      queryVector,
      organizationId,
      limit,
    )) as RagRow[];

    return rows.map((r) => ({
      text: r.text,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      score: typeof r.score === 'string' ? parseFloat(r.score as any) : (r.score as number),
    }));
  }

  /**
   * Fallback text search when there are no usable query terms — returns the most
   * recent chunks for the org with score 0.
   */
  async textSearchRecent(organizationId: string, limit: number): Promise<RagRow[]> {
    const rows = await this._aiContentIndex.model.aIContentIndex.findMany({
      where: {
        organizationId,
        chunk: { not: null },
      },
      select: {
        chunk: true,
        sourceType: true,
        sourceId: true,
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return (rows as Array<{ chunk: string | null; sourceType: string; sourceId: string }>).map(
      (r) => ({
        text: r.chunk || '',
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        score: 0,
      }),
    );
  }

  /**
   * ILIKE-based lexical fallback search, org-scoped. `terms` (already split,
   * filtered, and capped by the caller) are matched with OR'd ILIKE clauses; the
   * score is the fraction of terms matched. SQL parameterization preserved:
   * $1..$n are terms, $n+1 is organizationId, $n+2 is the limit.
   */
  async textSearchTerms(
    organizationId: string,
    terms: string[],
    limit: number,
  ): Promise<RagRow[]> {
    // SAFETY: terms.length is interpolated into SQL (`${terms.length}::float`,
    // `${terms.length + 1}`, `${terms.length + 2}`). Assert it's a non-negative
    // integer so this cannot become an injection vector.
    if (!Number.isInteger(terms.length) || terms.length < 0) {
      throw new Error(`Invalid terms length: ${terms.length} — must be a non-negative integer`);
    }
    const likeClauses = terms.map((t, i) => `ci.chunk ILIKE '%' || $${i + 1} || '%'`).join(' OR ');

    const rows = (await this._raw.$queryRawUnsafe(
      `SELECT
        ci.chunk AS text,
        ci."sourceType" AS "sourceType",
        ci."sourceId" AS "sourceId",
        COUNT(*)::float / ${terms.length}::float AS score
      FROM "AIContentIndex" ci
      WHERE ci."organizationId" = $${terms.length + 1}
        AND ci.chunk IS NOT NULL
        AND ci.chunk != ''
        AND (${likeClauses})
      GROUP BY ci.id, ci.chunk, ci."sourceType", ci."sourceId"
      ORDER BY score DESC
      LIMIT $${terms.length + 2}`,
      ...terms,
      organizationId,
      limit,
    )) as RagRow[];

    return rows.map((r) => ({
      text: r.text,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      score: typeof r.score === 'string' ? parseFloat(r.score as any) : (r.score as number),
    }));
  }

  /**
   * Returns all content index entries for an org (for dashboard/status views).
   */
  getOrgContentIndexEntries(
    organizationId: string,
  ): Promise<Array<{ id: string; sourceType: string; sourceId: string; chunk: string | null; createdAt: Date; updatedAt: Date }>> {
    return this._aiContentIndex.model.aIContentIndex.findMany({
      where: { organizationId },
      select: { id: true, sourceType: true, sourceId: true, chunk: true, createdAt: true, updatedAt: true },
    }) as any;
  }

  /**
   * Deletes all content index entries for a given source, org-scoped.
   * Embedding side table rows are cascade-deleted by the FK constraint.
   */
  deleteContentIndexEntries(organizationId: string, sourceType: string, sourceId: string) {
    return this._aiContentIndex.model.aIContentIndex.deleteMany({
      where: { organizationId, sourceType, sourceId },
    });
  }

  /**
   * Loads an org's non-deleted posts for the backfill sweep.
   */
  findPostsForBackfill(
    organizationId: string,
  ): Promise<Array<{ id: string; content: string | null; title: string | null; description: string | null }>> {
    return this._raw.post.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, content: true, title: true, description: true },
    });
  }

  /**
   * Loads an org's non-deleted media for the backfill sweep.
   */
  findMediaForBackfill(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string | null; originalName: string | null; alt: string | null }>> {
    return this._raw.media.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, originalName: true, alt: true },
    });
  }

  /**
   * Finds the org's top-performing published posts (by engagement) for brand
   * memory indexing. Returns the top N posts ordered by combined engagement.
   */
  findTopPerformingPosts(
    organizationId: string,
    limit: number = 10,
  ): Promise<Array<{ id: string; content: string | null; title: string | null; description: string | null; lastLikes: number | null; lastComments: number | null }>> {
    return this._raw.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
      },
      select: {
        id: true,
        content: true,
        title: true,
        description: true,
        lastLikes: true,
        lastComments: true,
      },
      orderBy: [
        { lastLikes: { sort: 'desc', nulls: 'last' } },
        { lastComments: { sort: 'desc', nulls: 'last' } },
      ],
      take: limit,
    });
  }
}
