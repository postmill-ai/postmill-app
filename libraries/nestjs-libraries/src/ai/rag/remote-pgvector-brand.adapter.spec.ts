import { beforeEach, describe, expect, it, vi } from 'vitest';

const pg = vi.hoisted(() => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn(),
  };
  return { pool, client };
});
vi.mock('pg', () => ({
  escapeIdentifier: (value: string) => `"${value}"`,
  Pool: class { constructor() { return pg.pool; } },
}));

import { RemotePgVectorStoreAdapter } from './remote-pgvector.adapter';

const adapter = () => new RemotePgVectorStoreAdapter({ connectionString: 'postgres://localhost/x', dimension: 3 });

describe('RemotePgVectorStoreAdapter Brand Kit metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pg.pool.query.mockResolvedValue({ rows: [] });
    pg.client.query.mockResolvedValue({ rows: [] });
  });

  it('filters vector search by brand in SQL', async () => {
    await adapter().search('org-1', [0.1, 0.2, 0.3], 2, { brandProfileId: 'brand-1' });
    const call = pg.pool.query.mock.calls.find(([sql]) => String(sql).includes('SELECT "text"'));
    expect(call?.[0]).toContain('AND "brandProfileId" = $4');
    expect(call?.[1]).toEqual(['[0.1,0.2,0.3]', 'org-1', 2, 'brand-1']);
  });

  it('adds and writes the nullable brand column', async () => {
    await adapter().upsertBatch('org-1', [{
      id: 'chunk-1', vector: [0.1, 0.2, 0.3], text: 'Fact', sourceType: 'text', sourceId: 'source-1', brandProfileId: 'brand-1',
    }]);
    expect(pg.pool.query.mock.calls.some(([sql]) => String(sql).includes('ADD COLUMN IF NOT EXISTS "brandProfileId"'))).toBe(true);
    const insert = pg.client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO'));
    expect(insert?.[0]).toContain('"brandProfileId"');
    expect(insert?.[1]).toEqual(['chunk-1', 'org-1', 'text', 'source-1', 'brand-1', 'Fact', '[0.1,0.2,0.3]']);
  });
});
