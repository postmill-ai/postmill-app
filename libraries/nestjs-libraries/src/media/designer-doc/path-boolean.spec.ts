import { describe, it, expect } from 'vitest';
import {
  booleanPaths,
  booleanPolygons,
  flattenPath,
  pointInPolygon,
  polygonArea,
  type Point,
} from './path-boolean';

/**
 * Pathfinder.
 *
 * Booleans are where a geometry library either handles the awkward cases or
 * crashes on them, so the disjoint, contained, touching and degenerate inputs
 * get as much attention here as the ordinary overlap.
 */

const square = (x: number, y: number, size: number): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const area = (polys: Point[][]) =>
  polys.reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0);

const A = square(0, 0, 10);
// Overlaps A across a 5×5 corner.
const B = square(5, 5, 10);

describe('pointInPolygon', () => {
  it('finds a point inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, A)).toBe(true);
  });

  it('finds a point outside', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, A)).toBe(false);
  });

  it('does not fall over on a horizontal edge', () => {
    expect(() => pointInPolygon({ x: 5, y: 0 }, A)).not.toThrow();
  });
});

describe('flattenPath', () => {
  it('keeps a straight-segment ring as it is', () => {
    expect(flattenPath(A)).toHaveLength(4);
  });

  it('subdivides a curved segment', () => {
    const curved = [
      { x: 0, y: 0, outX: 0, outY: 10 },
      { x: 10, y: 10, inX: 10, inY: 0 },
    ];
    expect(flattenPath(curved).length).toBeGreaterThan(10);
  });

  it('survives a one-node path', () => {
    expect(flattenPath([{ x: 3, y: 4 }])).toEqual([{ x: 3, y: 4 }]);
  });

  it('survives an empty path', () => {
    expect(flattenPath([])).toEqual([]);
  });
});

describe('unite', () => {
  it('is bigger than either input where they overlap', () => {
    const r = booleanPolygons(A, B, 'unite');
    expect(area(r.polygons)).toBeGreaterThan(100);
    expect(area(r.polygons)).toBeLessThan(200);
  });

  it('keeps both rings when they never touch', () => {
    const r = booleanPolygons(A, square(100, 100, 10), 'unite');
    expect(r.polygons).toHaveLength(2);
  });

  it('collapses to the outer ring when one contains the other', () => {
    const r = booleanPolygons(square(2, 2, 3), A, 'unite');
    expect(r.polygons).toHaveLength(1);
    expect(area(r.polygons)).toBeCloseTo(100, 5);
  });
});

describe('intersect', () => {
  it('is the overlapping corner', () => {
    const r = booleanPolygons(A, B, 'intersect');
    expect(area(r.polygons)).toBeCloseTo(25, 1);
  });

  it('is empty when they never touch', () => {
    expect(booleanPolygons(A, square(100, 100, 10), 'intersect').polygons).toEqual([]);
  });

  it('is the inner ring when one contains the other', () => {
    const r = booleanPolygons(square(2, 2, 3), A, 'intersect');
    expect(area(r.polygons)).toBeCloseTo(9, 5);
  });
});

describe('subtract', () => {
  it('removes the overlap from the subject', () => {
    const r = booleanPolygons(A, B, 'subtract');
    expect(area(r.polygons)).toBeCloseTo(75, 1);
  });

  it('returns the subject untouched when the clip misses', () => {
    const r = booleanPolygons(A, square(100, 100, 10), 'subtract');
    expect(r.polygons).toHaveLength(1);
    expect(area(r.polygons)).toBeCloseTo(100, 5);
  });

  it('is empty when the subject is wholly inside the clip', () => {
    expect(booleanPolygons(square(2, 2, 3), A, 'subtract').polygons).toEqual([]);
  });

  it('leaves a hole when the clip is wholly inside the subject', () => {
    // Two rings, punched out by the even-odd fill rule — not a single ring.
    const r = booleanPolygons(A, square(2, 2, 3), 'subtract');
    expect(r.polygons).toHaveLength(2);
  });
});

describe('exclude', () => {
  it('drops the overlap and keeps both remainders', () => {
    const r = booleanPolygons(A, B, 'exclude');
    expect(area(r.polygons)).toBeCloseTo(150, 1);
  });
});

describe('divide', () => {
  it('returns all three regions of an overlap', () => {
    const r = booleanPolygons(A, B, 'divide');
    expect(r.polygons.length).toBeGreaterThanOrEqual(3);
    // A-only + B-only + the shared corner = both squares, counted once each.
    expect(area(r.polygons)).toBeCloseTo(175, 1);
  });

  it('returns two pieces for shapes that miss each other', () => {
    expect(booleanPolygons(A, square(100, 100, 10), 'divide').polygons).toHaveLength(2);
  });
});

describe('outline', () => {
  it('keeps every ring — outline discards fills, not geometry', () => {
    expect(booleanPolygons(A, B, 'outline').polygons).toHaveLength(2);
  });
});

describe('degenerate input', () => {
  it('returns the subject when the clip is not a closed area', () => {
    const line: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(booleanPolygons(A, line, 'subtract').polygons).toEqual([A]);
  });

  it('returns nothing when neither input is an area', () => {
    expect(booleanPolygons([{ x: 0, y: 0 }], [], 'unite').polygons).toEqual([]);
  });

  it('does not hang on a self-intersecting subject', () => {
    // A bowtie: the classic case that spins a naive traversal forever.
    const bowtie: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const r = booleanPolygons(bowtie, B, 'intersect');
    expect(Array.isArray(r.polygons)).toBe(true);
  });

  it('does not hang on two identical rings', () => {
    // Every edge is collinear — there is no strict crossing to find.
    const r = booleanPolygons(A, [...A], 'intersect');
    expect(area(r.polygons)).toBeCloseTo(100, 5);
  });

  it('does not hang on rings that share exactly one corner', () => {
    const r = booleanPolygons(A, square(10, 10, 10), 'unite');
    expect(r.polygons.length).toBeGreaterThan(0);
  });
});

describe('booleanPaths', () => {
  it('gives back path nodes, ready to store on an element', () => {
    const nodes = booleanPaths(A, B, 'intersect');
    expect(nodes).toHaveLength(1);
    expect(nodes[0][0]).toHaveProperty('x');
    expect(nodes[0][0]).toHaveProperty('y');
    // Flattened: the result carries no bezier handles.
    expect(nodes[0].every((n) => n.outX === undefined && n.inX === undefined)).toBe(true);
  });
});
