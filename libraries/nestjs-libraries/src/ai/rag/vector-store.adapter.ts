export interface RagHit {
  text: string;
  sourceType: string;
  sourceId: string;
  score: number;
}

export interface VectorStoreAdapter {
  readonly type: 'pgvector' | 'qdrant' | 'pinecone' | 'pgvector-remote';
  probe(): Promise<boolean>;
  search(organizationId: string, vector: number[], limit: number, filter?: Record<string, any>): Promise<RagHit[]>;
  upsertBatch(organizationId: string, points: Array<{ id: string; vector: number[]; text: string; sourceType: string; sourceId: string }>): Promise<void>;
  removeSource(organizationId: string, sourceType: string, sourceId: string): Promise<void>;
  // Optional teardown for adapters that own a connection pool (remote pgvector).
  close?(): Promise<void>;
}
