import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PineconeVectorStoreAdapter } from './pinecone.adapter';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({ safeFetch: fetchMock }));

const adapter = () => new PineconeVectorStoreAdapter({
  apiKey: 'secret',
  host: 'https://index.example.test',
  dimension: 3,
});

describe('PineconeVectorStoreAdapter Brand Kit metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) });
  });

  it('applies the brand as a native metadata filter', async () => {
    await adapter().search('org-1', [0.1, 0.2, 0.3], 2, { brandProfileId: 'brand-1' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe('https://index.example.test/query');
    expect(body.topK).toBe(2);
    expect(body.filter).toEqual({
      organizationId: { $eq: 'org-1' },
      brandProfileId: { $eq: 'brand-1' },
    });
  });

  it('stores the brand on every upserted vector', async () => {
    await adapter().upsertBatch('org-1', [{
      id: 'chunk-1', vector: [0.1, 0.2, 0.3], text: 'Fact', sourceType: 'text', sourceId: 'source-1', brandProfileId: 'brand-1',
    }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.vectors[0].metadata).toMatchObject({
      organizationId: 'org-1', sourceId: 'source-1', brandProfileId: 'brand-1',
    });
  });
});
