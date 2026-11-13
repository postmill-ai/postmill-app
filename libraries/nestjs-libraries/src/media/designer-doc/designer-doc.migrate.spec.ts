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

describe('video character references', () => {
  it('carries saved references through a re-normalise and omits malformed values', () => {
    const characterReferences = [{ fileId: 'file-1', src: '/uploads/hero.png', name: 'Hero' }];
    const raw = {
      version: 9,
      mode: 'video',
      outputs: [],
      characterReferences,
    };
    expect(migrateDoc(raw).characterReferences).toEqual(characterReferences);
    expect('characterReferences' in migrateDoc({ ...raw, characterReferences: 'nope' })).toBe(false);
  });
});

describe('optional-additive document fields', () => {
  it('preserves a compatible output frozen flag without another version bump', () => {
    const outputs = [{ id: 'video', frozen: true, tracks: [] }];
    const migrated = migrateDoc({ version: 13, mode: 'video', outputs });
    expect(migrated.version).toBe(13);
    expect(migrated.outputs).toBe(outputs);
    expect((migrated.outputs[0] as any).frozen).toBe(true);
  });

  it('stamps v14 when an older document carries textStroke', () => {
    const outputs = [{
      id: 'video',
      tracks: [{
        id: 'text',
        type: 'text',
        clips: [{ id: 'clip', textStroke: { color: '#000000', width: 2 } }],
      }],
    }];
    expect(migrateDoc({ version: 10, mode: 'video', outputs }).version).toBe(14);
    expect(migrateDoc({ version: 10, mode: 'video', outputs: [] }).version).toBe(10);
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
