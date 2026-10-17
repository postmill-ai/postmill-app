import { describe, it, expect } from 'vitest';
import { DESIGNER_DOC_VERSION, migrateDoc } from './designer-doc.migrate';

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

  it('stamps a current-shape doc missing a version', () => {
    const { version, ...rest } = doc();
    expect(migrateDoc(rest).version).toBe(DESIGNER_DOC_VERSION);
  });
});

describe('zero legacy support', () => {
  it('does not rewrite a legacy root shape — it passes through for the schema to reject', () => {
    const legacy = { version: 1, width: 1080, height: 1080, pages: [] };
    expect(migrateDoc(legacy)).toBe(legacy);
    expect(migrateDoc(undefined)).toBeUndefined();
    expect(migrateDoc(null)).toBeNull();
  });
});


describe('clip speed curves (v7, optional-additive)', () => {
  it('leaves a ramped clip untouched by load normalisation', () => {
    // migrateDoc only re-stamps the root; the outputs pass through by
    // reference, so a speedCurve must survive verbatim.
    const speedCurve = [
      { atMs: 0, speed: 1 },
      { atMs: 1000, speed: 3 },
    ];
    const raw = {
      version: 7,
      mode: 'video',
      outputs: [
        {
          id: 'o',
          formatId: 'square',
          name: 'S',
          width: 100,
          height: 100,
          fps: 30,
          durationMs: 5000,
          tracks: [
            { id: 't', type: 'video', clips: [{ id: 'c', startMs: 0, endMs: 4000, speedCurve }] },
          ],
        },
      ],
    };
    const migrated = migrateDoc(raw);
    expect((migrated.outputs[0] as any).tracks[0].clips[0].speedCurve).toEqual(speedCurve);
  });
});
