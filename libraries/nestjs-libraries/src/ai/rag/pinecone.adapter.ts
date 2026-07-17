import { VectorStoreAdapter, RagHit } from './vector-store.adapter';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

interface PineconeConfig {
  apiKey: string;
  // Either the data-plane host (https://<index>-<proj>.svc.<region>.pinecone.io)
  // or the index name (resolved to a host via the control plane).
  host?: string;
  indexName?: string;
  dimension: number;
}

// Pinecone serverless data-plane over REST (no SDK dependency), org-scoped by a
// metadata filter. All outbound calls go through safeFetch (SSRF-guarded) since
// the host is admin-supplied. Mirrors the Qdrant adapter's external-store shape.
export class PineconeVectorStoreAdapter implements VectorStoreAdapter {
  readonly type = 'pinecone' as const;
  private _host: string | null = null;

  constructor(private _cfg: PineconeConfig) {}

  private _normalizeHost(h: string): string {
    const trimmed = h.trim().replace(/\/+$/, '');
    return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  // Resolve (and cache) the data-plane host. Explicit host wins; otherwise the
  // index name is resolved through the control plane.
  private async _resolveHost(): Promise<string> {
    if (this._host) return this._host;
    if (this._cfg.host) {
      this._host = this._normalizeHost(this._cfg.host);
      return this._host;
    }
    if (!this._cfg.indexName) {
      throw new Error('Pinecone host or index name is required');
    }
    const res = await safeFetch(
      `https://api.pinecone.io/indexes/${encodeURIComponent(this._cfg.indexName)}`,
      { headers: { 'Api-Key': this._cfg.apiKey } }
    );
    if (!res.ok) {
      throw new Error(`Pinecone index lookup failed (${res.status})`);
    }
    const data: any = await res.json();
    if (!data?.host) throw new Error('Pinecone index has no host');
    this._host = this._normalizeHost(data.host);
    return this._host;
  }

  private async _dataFetch(path: string, body: any): Promise<any> {
    const host = await this._resolveHost();
    const res = await safeFetch(`${host}${path}`, {
      method: 'POST',
      headers: {
        'Api-Key': this._cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pinecone ${path} failed (${res.status}) ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async probe(): Promise<boolean> {
    try {
      // Resolving the host validates the key + index; stats confirms reachability.
      await this._dataFetch('/describe_index_stats', {});
      return true;
    } catch {
      return false;
    }
  }

  async search(
    organizationId: string,
    vector: number[],
    limit: number,
    filter?: Record<string, any>
  ): Promise<RagHit[]> {
    const data = await this._dataFetch('/query', {
      vector,
      topK: limit,
      includeMetadata: true,
      filter: { organizationId: { $eq: organizationId }, ...filter },
    });
    return (data?.matches || [])
      .filter((m: any) => m?.metadata?.organizationId === organizationId)
      .map((m: any) => ({
        text: String(m?.metadata?.text ?? ''),
        sourceType: String(m?.metadata?.sourceType ?? ''),
        sourceId: String(m?.metadata?.sourceId ?? ''),
        score: typeof m?.score === 'number' ? m.score : 0,
      }));
  }

  async upsertBatch(
    organizationId: string,
    points: Array<{ id: string; vector: number[]; text: string; sourceType: string; sourceId: string }>
  ): Promise<void> {
    if (points.length === 0) return;
    await this._dataFetch('/vectors/upsert', {
      vectors: points.map((p) => ({
        id: p.id,
        values: p.vector,
        metadata: {
          organizationId,
          text: p.text,
          sourceType: p.sourceType,
          sourceId: p.sourceId,
        },
      })),
    });
  }

  async removeSource(
    organizationId: string,
    sourceType: string,
    sourceId: string
  ): Promise<void> {
    // Metadata-filtered delete (serverless supports filter delete).
    try {
      await this._dataFetch('/vectors/delete', {
        filter: { organizationId, sourceType, sourceId },
      });
    } catch {
      // Best-effort — pruning also runs through the local content-index flow.
    }
  }
}
