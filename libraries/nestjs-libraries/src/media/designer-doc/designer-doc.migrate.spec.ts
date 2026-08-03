import { describe, it, expect } from 'vitest';
import { migrateDoc } from './designer-doc.migrate';

/**
 * Loading a saved document. Anything `migrateDoc` forgets to copy across is
 * silently lost on the next open, which makes omissions here expensive.
 */
describe('doc-level symbols (v6)', () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    version: 6,
    mode: 'image',
    outputs: [
      {
        id: 'o',
        formatId: 'square',
        name: 'S',
        width: 100,
        height: 100,
        background: '#fff',
        children: [],
      },
    ],
    ...over,
  });

  it('carries symbol definitions through a re-normalise', () => {
    // Dropping them here would lose every symbol instance on the next load.
    const symbols = [{ id: 's1', name: 'Logo', width: 10, height: 10, children: [] }];
    expect((migrateDoc(doc({ symbols })) as { symbols?: unknown }).symbols).toEqual(symbols);
  });

  it('adds no symbols key to a document that has none', () => {
    expect('symbols' in (migrateDoc(doc()) as object)).toBe(false);
  });

  it('ignores a symbols value that is not a list', () => {
    expect('symbols' in (migrateDoc(doc({ symbols: 'nope' })) as object)).toBe(false);
  });
});
