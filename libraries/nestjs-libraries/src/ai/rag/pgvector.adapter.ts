import { Injectable } from '@nestjs/common';
import { AiRagRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-rag/ai-rag.repository';
import { VectorStoreAdapter, RagHit } from './vector-store.adapter';

@Injectable()
export class PgVectorStoreAdapter implements VectorStoreAdapter {
  readonly type = 'pgvector' as const;

  constructor(private _aiRagRepository: AiRagRepository) {}

  async probe(): Promise<boolean> {
    try {
      const { pgvectorAvailable } = await this._ensureTable();
      return pgvectorAvailable;
    } catch {
      return false;
    }
  }

  private async _ensureTable(): Promise<{ pgvectorAvailable: boolean; dimension: number }> {
    const dimension = 1536;
    try {
      await this._aiRagRepository.ensurePgvectorTable(dimension);
      return { pgvectorAvailable: true, dimension };
    } catch {
      return { pgvectorAvailable: false, dimension };
    }
  }

  async search(organizationId: string, vector: number[], limit: number, _filter?: Record<string, any>): Promise<RagHit[]> {
    const queryVector = '[' + vector.join(',') + ']';
    return this._aiRagRepository.vectorSearch(organizationId, queryVector, limit);
  }

  async upsertBatch(
    organizationId: string,
    points: Array<{ id: string; vector: number[]; text: string; sourceType: string; sourceId: string }>,
  ): Promise<void> {
    const { pgvectorAvailable, dimension } = await this._ensureTable();
    if (!pgvectorAvailable) return;

    await this._aiRagRepository.replaceSourceChunks({
      organizationId,
      sourceType: points[0]?.sourceType || 'unknown',
      sourceId: points[0]?.sourceId || 'unknown',
      contentHash: '',
      chunks: points.map((p) => p.text),
      embeddings: points.map((p) => p.vector),
      pgvectorAvailable,
      formatVector: (arr) => '[' + arr.join(',') + ']',
    });
  }

  async removeSource(organizationId: string, sourceType: string, sourceId: string): Promise<void> {
    await this._aiRagRepository.deleteContentIndexEntries(organizationId, sourceType, sourceId);
  }
}
