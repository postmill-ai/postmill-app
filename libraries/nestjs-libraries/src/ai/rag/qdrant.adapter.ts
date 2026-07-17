import { Injectable } from '@nestjs/common';
import { VectorStoreAdapter, RagHit } from './vector-store.adapter';

interface QdrantConfig {
  url: string;
  apiKey?: string;
  collectionName: string;
  dimension: number;
  distance?: 'Cosine' | 'Euclid' | 'Dot';
}

@Injectable()
export class QdrantVectorStoreAdapter implements VectorStoreAdapter {
  readonly type = 'qdrant' as const;
  private _client: any = null;

  constructor(private _cfg: QdrantConfig) {}

  private async _getClient(): Promise<any> {
    if (this._client) return this._client;
    const { QdrantClientWrapper } = await import('@reaatech/hybrid-rag-qdrant');
    this._client = new QdrantClientWrapper({
      url: this._cfg.url,
      apiKey: this._cfg.apiKey,
      collectionName: this._cfg.collectionName,
      vectorSize: this._cfg.dimension,
      distance: this._cfg.distance || 'Cosine',
    });
    await this._client.initialize();
    return this._client;
  }

  async probe(): Promise<boolean> {
    try {
      const client = await this._getClient();
      return await client.healthCheck();
    } catch {
      return false;
    }
  }

  async search(organizationId: string, vector: number[], limit: number, filter?: Record<string, any>): Promise<RagHit[]> {
    const client = await this._getClient();
    const results: any[] = await client.search({
      vector,
      topK: limit,
      filter: { organizationId, ...filter },
    });
    return (results || [])
      .filter((r: any) => r?.metadata?.organizationId === organizationId)
      .map((r: any) => ({
        text: String(r?.content ?? r?.metadata?.text ?? ''),
        sourceType: String(r?.metadata?.sourceType ?? ''),
        sourceId: String(r?.metadata?.sourceId ?? ''),
        score: typeof r?.score === 'number' ? r.score : 0,
      }));
  }

  async upsertBatch(
    organizationId: string,
    points: Array<{ id: string; vector: number[]; text: string; sourceType: string; sourceId: string }>,
  ): Promise<void> {
    if (points.length === 0) return;
    const client = await this._getClient();
    await client.upsertBatch(
      points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: { organizationId, text: p.text, sourceType: p.sourceType, sourceId: p.sourceId },
      })),
    );
  }

  async removeSource(_organizationId: string, _sourceType: string, _sourceId: string): Promise<void> {
    // Qdrant handles deletion via the parent deleteContentIndexEntries flow
  }
}
