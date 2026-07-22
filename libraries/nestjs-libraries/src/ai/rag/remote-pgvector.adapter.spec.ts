import { describe, it, expect } from 'vitest';
import { RemotePgVectorStoreAdapter } from './remote-pgvector.adapter';

const base = { connectionString: 'postgres://localhost/x', dimension: 1536 };

describe('RemotePgVectorStoreAdapter config validation', () => {
  it('accepts a plain identifier table name', () => {
    expect(
      () => new RemotePgVectorStoreAdapter({ ...base, table: 'my_rag_v2' })
    ).not.toThrow();
  });

  it('defaults the table name when omitted', () => {
    expect(() => new RemotePgVectorStoreAdapter({ ...base })).not.toThrow();
  });

  it('rejects table names with quotes, spaces, or SQL metacharacters', () => {
    for (const table of [
      'bad"name',
      'bad name',
      'bad;drop table x',
      'bad-name',
      '1leading_digit',
      'a'.repeat(64),
    ]) {
      expect(
        () => new RemotePgVectorStoreAdapter({ ...base, table })
      ).toThrow('Invalid pgvector table name');
    }
  });

  it('rejects non-integer or non-positive dimensions', () => {
    expect(
      () => new RemotePgVectorStoreAdapter({ ...base, dimension: 0 })
    ).toThrow('Invalid pgvector dimension');
    expect(
      () => new RemotePgVectorStoreAdapter({ ...base, dimension: 1.5 })
    ).toThrow('Invalid pgvector dimension');
  });
});
