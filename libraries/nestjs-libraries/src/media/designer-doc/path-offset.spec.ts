import { describe, it, expect } from 'vitest';
import { offsetPath, offsetPolygon, roundCorners } from './path-offset';
import { polygonArea, flattenPath, type Point } from './path-boolean';

const square = (x: number, y: number, size: number): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('offsetPolygon', () => {
  it('grows a square by the distance on every side', () => {
    const out = offsetPolygon(square(0, 0, 10), 2);
    expect(Math.min(...out.map((p) => p.x))).toBeCloseTo(-2, 5);
    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(12, 5);
    expect(Math.abs(polygonArea(out))).toBeCloseTo(196, 5);
  });

  it('shrinks on a negative distance', () => {
    const out = offsetPolygon(square(0, 0, 10), -2);
    expect(Math.abs(polygonArea(out))).toBeCloseTo(36, 5);
  });

  it('grows a clockwise ring outwards too, not inwards', () => {
    // The left normal points the other way for the opposite winding; without
    // following the sign, half the shapes people draw would shrink.
    const clockwise = [...square(0, 0, 10)].reverse();
    const out = offsetPolygon(clockwise, 2);
    expect(Math.abs(polygonArea(out))).toBeCloseTo(196, 5);
  });

  it('is a no-op at zero distance', () => {
    const poly = square(0, 0, 10);
    expect(offsetPolygon(poly, 0)).toBe(poly);
  });

  it('keeps the original rather than inverting on an over-shrink', () => {
    // Shrinking a 10px square by 20px has no answer — past its own medial axis.
    const poly = square(0, 0, 10);
    expect(offsetPolygon(poly, -20)).toBe(poly);
  });

  it('leaves a degenerate ring alone', () => {
    const line: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(offsetPolygon(line, 3)).toBe(line);
  });

  it('handles a triangle without spiking', () => {
    const tri: Point[] = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }];
    const out = offsetPolygon(tri, 2);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Math.hypot(p.x - 10, p.y - 7)).toBeLessThan(60);
    }
  });
});

describe('offsetPath', () => {
  it('gives back path nodes', () => {
    const nodes = offsetPath(square(0, 0, 10), 1);
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toHaveProperty('x');
  });
});

describe('roundCorners', () => {
  const sq = square(0, 0, 20);

  it('replaces each corner with two anchors', () => {
    expect(roundCorners(sq, 4)).toHaveLength(8);
  });

  it('puts the bezier handles on the old corner', () => {
    const rounded = roundCorners(sq, 4);
    // First pair straddles the (0,0) corner.
    expect(rounded[0].outX).toBeCloseTo(0);
    expect(rounded[0].outY).toBeCloseTo(0);
    expect(rounded[1].inX).toBeCloseTo(0);
    expect(rounded[1].inY).toBeCloseTo(0);
  });

  it('never eats more than half an edge', () => {
    // Otherwise neighbouring corners overlap and the path folds back.
    const rounded = roundCorners(sq, 500);
    const xs = rounded.map((n) => n.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(20);
  });

  it('is a no-op at zero radius', () => {
    expect(roundCorners(sq, 0)).toBe(sq);
  });

  it('leaves a two-point path alone', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(roundCorners(line, 2)).toBe(line);
  });

  it('produces a path that still traces', () => {
    const rounded = roundCorners(sq, 4);
    expect(flattenPath(rounded).length).toBeGreaterThan(8);
  });
});
