import { VectorStoreAdapter, RagHit } from './vector-store.adapter';

interface RemotePgConfig {
  connectionString: string;
  table?: string;
  dimension: number;
}

const formatVector = (arr: number[]): string => '[' + arr.join(',') + ']';

// Self-contained vector store on an EXTERNAL Postgres + pgvector, addressed by a
// connection string. Owns its own `pg` Pool (lazy-imported as `any`, like the
// Qdrant SDK) so it never touches the app's Prisma connection. The table holds
// both the chunk text and the embedding (the local AIContentIndex chunk rows are
// still written by RagService for BM25 fusion, exactly like the Qdrant path).
export class RemotePgVectorStoreAdapter implements VectorStoreAdapter {
  readonly type = 'pgvector-remote' as const;
  private _pool: any = null;
  private _ensured = false;
  private readonly _table: string;
  private readonly _dimension: number;

  constructor(cfg: RemotePgConfig) {
    this._connectionString = cfg.connectionString;
    if (!Number.isInteger(cfg.dimension) || cfg.dimension <= 0) {
      throw new Error('Invalid pgvector dimension');
    }
    this._dimension = cfg.dimension;
    // Table name must be a plain SQL identifier — reject (not strip) anything else
    // so a misconfigured name fails loudly instead of silently aliasing a table.
    const t = cfg.table || 'postmill_rag';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(t)) {
      throw new Error('Invalid pgvector table name');
    }
    this._table = t;
  }

  private _connectionString: string;
  private _escapeIdent: ((name: string) => string) | null = null;

  private async _getPool(): Promise<any> {
    if (this._pool) return this._pool;
    const pg: any = await import('pg');
    const Pool = pg.Pool || pg.default?.Pool;
    this._escapeIdent = pg.escapeIdentifier || pg.default?.escapeIdentifier || null;
    this._pool = new Pool({ connectionString: this._connectionString, max: 4 });
    return this._pool;
  }

  // Quoted identifier via pg's escapeIdentifier; the constructor-validated name
  // makes the fallback quoting safe.
  private _ident(name: string): string {
    return this._escapeIdent ? this._escapeIdent(name) : `"${name}"`;
  }

  private async _ensureTable(): Promise<void> {
    if (this._ensured) return;
    const pool = await this._getPool();
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    const table = this._ident(this._table);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
         "id" text PRIMARY KEY,
         "organizationId" text NOT NULL,
         "sourceType" text NOT NULL,
         "sourceId" text NOT NULL,
         "text" text,
         "embedding" vector(${this._dimension}) NOT NULL
       )`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${this._ident(`${this._table}_hnsw_idx`)} ON ${table}
       USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 200)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${this._ident(`${this._table}_org_idx`)} ON ${table} ("organizationId")`
    );
    this._ensured = true;
  }

  async probe(): Promise<boolean> {
    try {
      await this._ensureTable();
      return true;
    } catch {
      return false;
    }
  }

  async search(
    organizationId: string,
    vector: number[],
    limit: number
  ): Promise<RagHit[]> {
    await this._ensureTable();
    const pool = await this._getPool();
    const res = await pool.query(
      `SELECT "text", "sourceType", "sourceId",
              (1 - ("embedding" <=> $1::vector)) AS score
       FROM ${this._ident(this._table)}
       WHERE "organizationId" = $2
       ORDER BY "embedding" <=> $1::vector
       LIMIT $3`,
      [formatVector(vector), organizationId, limit]
    );
    return (res.rows || []).map((r: any) => ({
      text: String(r.text ?? ''),
      sourceType: String(r.sourceType ?? ''),
      sourceId: String(r.sourceId ?? ''),
      score: typeof r.score === 'number' ? r.score : Number(r.score) || 0,
    }));
  }

  async upsertBatch(
    organizationId: string,
    points: Array<{ id: string; vector: number[]; text: string; sourceType: string; sourceId: string }>
  ): Promise<void> {
    if (points.length === 0) return;
    await this._ensureTable();
    const pool = await this._getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of points) {
        await client.query(
          `INSERT INTO ${this._ident(this._table)}
             ("id", "organizationId", "sourceType", "sourceId", "text", "embedding")
           VALUES ($1, $2, $3, $4, $5, $6::vector)
           ON CONFLICT ("id") DO UPDATE SET
             "organizationId" = EXCLUDED."organizationId",
             "sourceType" = EXCLUDED."sourceType",
             "sourceId" = EXCLUDED."sourceId",
             "text" = EXCLUDED."text",
             "embedding" = EXCLUDED."embedding"`,
          [p.id, organizationId, p.sourceType, p.sourceId, p.text, formatVector(p.vector)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async removeSource(
    organizationId: string,
    sourceType: string,
    sourceId: string
  ): Promise<void> {
    try {
      const pool = await this._getPool();
      await pool.query(
        `DELETE FROM ${this._ident(this._table)}
         WHERE "organizationId" = $1 AND "sourceType" = $2 AND "sourceId" = $3`,
        [organizationId, sourceType, sourceId]
      );
    } catch {
      // Best-effort.
    }
  }

  async close(): Promise<void> {
    if (this._pool) {
      try {
        await this._pool.end();
      } catch {
        // ignore pool teardown failure
      }
      this._pool = null;
      this._ensured = false;
    }
  }
}
