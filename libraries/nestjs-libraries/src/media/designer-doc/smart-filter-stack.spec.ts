import { describe, it, expect } from 'vitest';
import {
  applySmartFilters,
  enabledSmartFilters,
  hasSmartFilters,
  smartFilterCacheKey,
  smartFilterSource,
} from './smart-filter-stack';
import type { DesignerSmartFilter } from './designer-doc.schema';

/**
 * The rules the client bake and the server renderer must agree on. Each of
 * these is a way the two could silently disagree and render one document two
 * ways.
 */

const buffer = (width: number, height: number, fill = 128) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(fill),
});

describe('smartFilterSource', () => {
  it('reads the original, never the already-filtered pixels', () => {
    // The whole design exists to avoid compounding. On the server this would
    // mean an image degrading a little on every single render.
    expect(smartFilterSource({ originalSrc: 'orig.png', src: 'baked.png' })).toBe('orig.png');
  });

  it('falls back to src before the original has been frozen', () => {
    expect(smartFilterSource({ src: 'first.png' })).toBe('first.png');
  });

  it('is undefined when there is nothing to read', () => {
    expect(smartFilterSource({})).toBeUndefined();
  });
});

describe('enabledSmartFilters', () => {
  it('keeps array order — a blur then a mosaic is not the reverse', () => {
    const stack: DesignerSmartFilter[] = [{ id: 'gaussian-blur' }, { id: 'mosaic' }];
    expect(enabledSmartFilters(stack).map((f) => f.id)).toEqual(['gaussian-blur', 'mosaic']);
  });

  it('skips a disabled entry without disturbing the rest', () => {
    const stack: DesignerSmartFilter[] = [
      { id: 'gaussian-blur' },
      { id: 'mosaic', enabled: false },
      { id: 'sharpen' },
    ];
    expect(enabledSmartFilters(stack).map((f) => f.id)).toEqual(['gaussian-blur', 'sharpen']);
  });

  it('treats a missing `enabled` as on', () => {
    expect(enabledSmartFilters([{ id: 'sharpen' }])).toHaveLength(1);
  });

  it('drops an id this build does not know', () => {
    // A document saved by a newer build should render, not explode.
    expect(enabledSmartFilters([{ id: 'not-a-real-filter' }])).toHaveLength(0);
  });

  it('handles an absent stack', () => {
    expect(enabledSmartFilters(undefined)).toEqual([]);
  });
});

describe('hasSmartFilters', () => {
  it('is false for a stack that would change nothing', () => {
    // Otherwise the renderer takes the expensive decode-and-filter path to
    // produce pixels identical to the ones it already had.
    expect(hasSmartFilters({ smartFilters: [] })).toBe(false);
    expect(hasSmartFilters({ smartFilters: [{ id: 'sharpen', enabled: false }] })).toBe(false);
    expect(hasSmartFilters({ smartFilters: [{ id: 'unknown-to-this-build' }] })).toBe(false);
    expect(hasSmartFilters({})).toBe(false);
  });

  it('is true when at least one entry applies', () => {
    expect(
      hasSmartFilters({ smartFilters: [{ id: 'unknown' }, { id: 'sharpen' }] })
    ).toBe(true);
  });
});

describe('smartFilterCacheKey', () => {
  it('separates different sources', () => {
    const stack: DesignerSmartFilter[] = [{ id: 'sharpen' }];
    expect(smartFilterCacheKey('a.png', stack)).not.toBe(smartFilterCacheKey('b.png', stack));
  });

  it('separates different params on the same filter', () => {
    expect(smartFilterCacheKey('a.png', [{ id: 'gaussian-blur', params: { radius: 2 } }])).not.toBe(
      smartFilterCacheKey('a.png', [{ id: 'gaussian-blur', params: { radius: 8 } }])
    );
  });

  it('separates order, because order is the effect', () => {
    expect(smartFilterCacheKey('a.png', [{ id: 'gaussian-blur' }, { id: 'mosaic' }])).not.toBe(
      smartFilterCacheKey('a.png', [{ id: 'mosaic' }, { id: 'gaussian-blur' }])
    );
  });

  it('ignores a disabled entry, so toggling one off reuses the earlier bake', () => {
    expect(
      smartFilterCacheKey('a.png', [{ id: 'sharpen' }, { id: 'mosaic', enabled: false }])
    ).toBe(smartFilterCacheKey('a.png', [{ id: 'sharpen' }]));
  });

  it('does not key on the element box — one photo, one bake, many elements', () => {
    // The stack is evaluated at source resolution precisely so that elements of
    // different sizes sharing a source share a result.
    const stack: DesignerSmartFilter[] = [{ id: 'sharpen' }];
    expect(smartFilterCacheKey('a.png', stack)).toBe(smartFilterCacheKey('a.png', stack));
  });
});

describe('applySmartFilters', () => {
  it('changes pixels when an entry applies', () => {
    const buf = buffer(8, 8);
    buf.data[0] = 0;
    const before = Uint8ClampedArray.from(buf.data);
    applySmartFilters(buf, [{ id: 'solarize' }]);
    expect(buf.data).not.toEqual(before);
  });

  it('is a no-op for a fully disabled stack', () => {
    const buf = buffer(8, 8);
    const before = Uint8ClampedArray.from(buf.data);
    applySmartFilters(buf, [{ id: 'solarize', enabled: false }]);
    expect(buf.data).toEqual(before);
  });

  it('is a no-op for an unknown id', () => {
    const buf = buffer(8, 8);
    const before = Uint8ClampedArray.from(buf.data);
    applySmartFilters(buf, [{ id: 'no-such-filter' }]);
    expect(buf.data).toEqual(before);
  });

  it('compounds when the same stack is run over its own output', () => {
    // Not a bug in this function — it is the reason `smartFilterSource` must
    // return `originalSrc`. Evaluating a stack over already-filtered pixels
    // gives a different, more-filtered picture every time, which server-side
    // would mean an image visibly degrading on each render.
    const edge = (w: number, h: number) => {
      const buf = buffer(w, h, 255);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w / 2; x++) buf.data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
      }
      return buf;
    };

    const once = edge(16, 16);
    applySmartFilters(once, [{ id: 'gaussian-blur', params: { radius: 3 } }]);

    const twice = edge(16, 16);
    applySmartFilters(twice, [{ id: 'gaussian-blur', params: { radius: 3 } }]);
    applySmartFilters(twice, [{ id: 'gaussian-blur', params: { radius: 3 } }]);

    expect(twice.data).not.toEqual(once.data);
  });

  it('leaves the buffer dimensions alone', () => {
    // A stack is a pixel operation, never a geometry one.
    const buf = buffer(9, 4);
    applySmartFilters(buf, [{ id: 'solarize' }, { id: 'sharpen' }]);
    expect([buf.width, buf.height]).toEqual([9, 4]);
    expect(buf.data).toHaveLength(9 * 4 * 4);
  });
});
