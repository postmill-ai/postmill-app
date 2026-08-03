import { describe, it, expect } from 'vitest';
import { addPoint, findPoint, movePoint, removePoint } from './curves-editor';
import { buildHistogram } from './histogram';

/**
 * The point-editing rules behind the curves grid, and the histogram behind it.
 *
 * Both are pure; the SVG that renders them is not worth a jsdom harness, but a
 * curve that can be dragged into a vertical segment silently makes the LUT
 * ambiguous, and that is worth pinning.
 */

const line = () => [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

describe('findPoint', () => {
  it('finds a point under the cursor', () => {
    expect(findPoint(line(), 2, 2)).toBe(0);
    expect(findPoint(line(), 253, 254)).toBe(1);
  });

  it('returns -1 in empty space', () => {
    expect(findPoint(line(), 128, 40)).toBe(-1);
  });

  it('prefers the nearer of two candidates', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 106, y: 106 },
      { x: 255, y: 255 },
    ];
    expect(findPoint(pts, 105, 105)).toBe(2);
  });
});

describe('addPoint', () => {
  it('inserts in x order', () => {
    const next = addPoint(line(), 128, 200);
    expect(next.map((p) => p.x)).toEqual([0, 128, 255]);
    expect(next[1].y).toBe(200);
  });

  it('clamps to the grid', () => {
    const next = addPoint(line(), 500, -80);
    // 500 collapses onto the existing endpoint at 255, so nothing is added.
    expect(next).toHaveLength(2);
    expect(addPoint(line(), 128, -80)[1].y).toBe(0);
    expect(addPoint(line(), 128, 900)[1].y).toBe(255);
  });

  it('refuses a duplicate x — two points there make the curve ambiguous', () => {
    const withPoint = addPoint(line(), 128, 200);
    expect(addPoint(withPoint, 128, 40)).toBe(withPoint);
  });

  it('stops at the schema cap of 32', () => {
    let pts = line();
    for (let x = 2; x < 250; x += 2) pts = addPoint(pts, x, x);
    expect(pts.length).toBe(32);
  });
});

describe('movePoint', () => {
  it('moves an interior point freely in y', () => {
    const pts = addPoint(line(), 128, 128);
    expect(movePoint(pts, 1, 128, 20)[1].y).toBe(20);
  });

  it('pins the endpoints in x — that is Levels, not Curves', () => {
    const moved = movePoint(line(), 0, 90, 40);
    expect(moved[0].x).toBe(0);
    expect(moved[0].y).toBe(40);
    expect(movePoint(line(), 1, 10, 10)[1].x).toBe(255);
  });

  it('will not let a point cross its neighbour', () => {
    let pts = addPoint(line(), 100, 100);
    pts = addPoint(pts, 150, 150);
    const moved = movePoint(pts, 1, 200, 100);
    expect(moved[1].x).toBe(149);
    expect(moved.map((p) => p.x)).toEqual([0, 149, 150, 255]);
  });

  it('ignores an index that is not there', () => {
    const pts = line();
    expect(movePoint(pts, 7, 10, 10)).toBe(pts);
  });
});

describe('removePoint', () => {
  it('removes an interior point', () => {
    const pts = addPoint(line(), 128, 200);
    expect(removePoint(pts, 1).map((p) => p.x)).toEqual([0, 255]);
  });

  it('keeps the endpoints — a curve needs both ends', () => {
    expect(removePoint(line(), 0)).toHaveLength(2);
    expect(removePoint(line(), 1)).toHaveLength(2);
  });
});

describe('buildHistogram', () => {
  const pixels = (rgba: number[][]) =>
    new Uint8ClampedArray(rgba.flat());

  it('counts each level into its own bucket', () => {
    const h = buildHistogram(pixels([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]));
    expect(h.r[0]).toBe(1);
    expect(h.r[255]).toBe(1);
    expect(h.r[128]).toBe(0);
  });

  it('normalises against the tallest bucket', () => {
    const h = buildHistogram(pixels([
      [10, 10, 10, 255],
      [10, 10, 10, 255],
      [200, 200, 200, 255],
    ]));
    expect(h.r[10]).toBe(1);
    expect(h.r[200]).toBeCloseTo(0.5);
  });

  it('ignores fully transparent pixels', () => {
    // Counting them puts a spike at 0 that no adjustment can move.
    const h = buildHistogram(pixels([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [120, 120, 120, 255],
    ]));
    expect(h.luma[0]).toBe(0);
    expect(h.luma[120]).toBe(1);
  });

  it('weights luma by the Rec. 709 coefficients', () => {
    const h = buildHistogram(pixels([[0, 255, 0, 255]]));
    expect(h.luma[182]).toBe(1);
  });

  it('survives an empty image without dividing by zero', () => {
    const h = buildHistogram(new Uint8ClampedArray(0));
    expect(h.luma.every((n) => n === 0)).toBe(true);
  });
});
