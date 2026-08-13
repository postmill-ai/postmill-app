import { describe, it, expect } from 'vitest';
import {
  createMask,
  fullMask,
  invertMask,
  expandMask,
  strokeBand,
  maskBounds,
  isEmptyMask,
  rectMask,
} from './selection-mask';

const set = (mask: ReturnType<typeof createMask>, x: number, y: number, v = 255) => {
  mask.data[y * mask.width + x] = v;
};
const at = (mask: ReturnType<typeof createMask>, x: number, y: number) =>
  mask.data[y * mask.width + x];

describe('fullMask', () => {
  it('selects every pixel', () => {
    const mask = fullMask(4, 3);
    expect(mask.data).toHaveLength(12);
    expect([...mask.data].every((v) => v === 255)).toBe(true);
  });
});

describe('invertMask', () => {
  it('swaps selected and unselected', () => {
    const mask = createMask(3, 1);
    set(mask, 1, 0);
    const inverted = invertMask(mask);
    expect([...inverted.data]).toEqual([255, 0, 255]);
  });

  it('inverts feathered edges proportionally rather than snapping them', () => {
    const mask = createMask(3, 1);
    mask.data[0] = 64;
    mask.data[1] = 128;
    mask.data[2] = 200;
    expect([...invertMask(mask).data]).toEqual([191, 127, 55]);
  });

  it('round-trips', () => {
    const mask = rectMask(8, 8, { x: 2, y: 2, width: 3, height: 3 });
    expect([...invertMask(invertMask(mask)).data]).toEqual([...mask.data]);
  });

  it('turns an empty selection into everything', () => {
    expect(isEmptyMask(invertMask(createMask(4, 4)))).toBe(false);
  });
});

describe('expandMask', () => {
  it('grows a single pixel into a square', () => {
    const mask = createMask(5, 5);
    set(mask, 2, 2);
    const grown = expandMask(mask, 1);
    expect(at(grown, 1, 1)).toBe(255);
    expect(at(grown, 3, 3)).toBe(255);
    expect(at(grown, 0, 0)).toBe(0);
  });

  it('shrinks back', () => {
    const mask = rectMask(9, 9, { x: 2, y: 2, width: 5, height: 5 });
    const shrunk = expandMask(mask, -1);
    expect(at(shrunk, 2, 2)).toBe(0);
    expect(at(shrunk, 4, 4)).toBe(255);
  });

  it('treats outside the canvas as unselected when shrinking', () => {
    // A selection touching the edge must pull away from it, not cling.
    const mask = fullMask(5, 5);
    const shrunk = expandMask(mask, -1);
    expect(at(shrunk, 0, 0)).toBe(0);
    expect(at(shrunk, 2, 2)).toBe(255);
  });

  it('is a no-op at radius 0', () => {
    const mask = rectMask(6, 6, { x: 1, y: 1, width: 2, height: 2 });
    expect(expandMask(mask, 0)).toBe(mask);
  });
});

describe('strokeBand', () => {
  const square = () => rectMask(11, 11, { x: 3, y: 3, width: 5, height: 5 });

  it('inside stays within the selection', () => {
    const band = strokeBand(square(), 1, 'inside');
    expect(at(band, 3, 3)).toBe(255); // on the edge
    expect(at(band, 5, 5)).toBe(0); // interior untouched
    expect(at(band, 2, 2)).toBe(0); // nothing outside
  });

  it('outside stays beyond the selection', () => {
    const band = strokeBand(square(), 1, 'outside');
    expect(at(band, 2, 2)).toBe(255);
    expect(at(band, 5, 5)).toBe(0);
  });

  it('center straddles the edge', () => {
    const band = strokeBand(square(), 2, 'center');
    expect(at(band, 3, 3)).toBe(255);
    expect(at(band, 2, 2)).toBe(255);
    expect(at(band, 5, 5)).toBe(0);
  });

  it('handles a disjoint selection, which outline tracing would not', () => {
    const mask = createMask(11, 3);
    set(mask, 1, 1);
    set(mask, 9, 1);
    const band = strokeBand(mask, 1, 'outside');
    expect(at(band, 0, 1)).toBe(255);
    expect(at(band, 8, 1)).toBe(255);
    expect(at(band, 5, 1)).toBe(0);
  });
});

describe('maskBounds', () => {
  it('is the tightest box around the selected pixels', () => {
    const mask = createMask(10, 10);
    set(mask, 3, 4);
    set(mask, 6, 8);
    expect(maskBounds(mask)).toEqual({ x: 3, y: 4, width: 4, height: 5 });
  });

  it('is null when nothing is selected', () => {
    expect(maskBounds(createMask(4, 4))).toBeNull();
  });
});
