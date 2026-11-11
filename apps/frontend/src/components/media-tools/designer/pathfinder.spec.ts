import { describe, it, expect } from 'vitest';
import { elementOutline, offsetElement, pathfinder, pathfinderMany, roundElementCorners } from './pathfinder';
import type { DesignerElement } from './designer.store';

/**
 * Pathfinder as a document edit.
 *
 * The geometry is specced next to the algorithm; what matters here is the part
 * specific to this app — canvas coordinates, and a result re-based onto its own
 * bounding box so the new path lands where the shapes were.
 */

const shape = (over: Partial<DesignerElement>): DesignerElement =>
  ({
    id: 'a',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: '#ff0000',
    ...over,
  }) as DesignerElement;

describe('elementOutline', () => {
  it('is in CANVAS coordinates, so two elements can be combined', () => {
    const pts = elementOutline(shape({ x: 50, y: 20 }));
    expect(Math.min(...pts.map((p) => p.x))).toBe(50);
    expect(Math.min(...pts.map((p) => p.y))).toBe(20);
  });

  it('traces an ellipse as a polygon', () => {
    expect(elementOutline(shape({ shape: 'ellipse' })).length).toBeGreaterThan(16);
  });

  it('traces a polygon shape from the shared geometry', () => {
    expect(elementOutline(shape({ shape: 'triangle' }))).toHaveLength(3);
  });

  it('rotates around the element origin and flips around its center', () => {
    const rotated = elementOutline(shape({ width: 100, height: 50, rotation: 90 }));
    expect(Math.min(...rotated.map((point) => point.x))).toBeCloseTo(-50, 6);
    expect(Math.max(...rotated.map((point) => point.x))).toBeCloseTo(0, 6);
    expect(Math.min(...rotated.map((point) => point.y))).toBeCloseTo(0, 6);
    expect(Math.max(...rotated.map((point) => point.y))).toBeCloseTo(100, 6);

    const flipped = elementOutline(shape({ x: 10, y: 20, width: 100, height: 50, flipX: true }));
    expect(Math.min(...flipped.map((point) => point.x))).toBeCloseTo(10, 6);
    expect(Math.max(...flipped.map((point) => point.x))).toBeCloseTo(110, 6);
  });

  it('flattens a path element', () => {
    const pts = elementOutline(
      shape({ type: 'path', nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] })
    );
    expect(pts).toHaveLength(3);
  });
});

describe('pathfinder', () => {
  const a = shape({ id: 'a', x: 0, y: 0 });
  const b = shape({ id: 'b', x: 50, y: 50 });

  it('produces a path — a united pair of shapes is no longer a shape', () => {
    const r = pathfinder(a, b, 'unite')!;
    expect(r.element.type).toBe('path');
    expect(r.element.closed).toBe(true);
  });

  it('re-bases the outline onto its own box, so it lands where the shapes were', () => {
    const r = pathfinder(a, b, 'intersect')!;
    expect(r.element.x).toBeCloseTo(50, 3);
    expect(r.element.y).toBeCloseTo(50, 3);
    // Nodes are element-local: none may be negative.
    expect(Math.min(...r.element.nodes!.map((n) => n.x))).toBeGreaterThanOrEqual(-1e-6);
  });

  it('inherits the subject’s style, not the clip’s', () => {
    const styled = shape({ id: 'a', fill: '#00ff00', stroke: '#0000ff', strokeWidth: 4 });
    const r = pathfinder(styled, b, 'unite')!;
    expect(r.element.fill).toBe('#00ff00');
    expect(r.element.stroke).toBe('#0000ff');
    expect(r.element.strokeWidth).toBe(4);
  });

  it('returns one element for unite and several for divide', () => {
    expect(pathfinder(a, b, 'unite')!.extra).toHaveLength(0);
    expect(pathfinder(a, b, 'divide')!.extra.length).toBeGreaterThan(0);
  });

  it('keeps a disjoint unite as two elements instead of dropping the clip', () => {
    const far = shape({ id: 'b', x: 200, y: 200 });
    const r = pathfinder(a, far, 'unite')!;
    expect(r.extra).toHaveLength(1);
    expect(r.extra[0].x).toBeCloseTo(200, 3);
  });

  it('unites vertically touching stacked rectangles into one rectangular node list', () => {
    const top = shape({ id: 'top', x: 0, y: 0, width: 100, height: 100 });
    const bottom = shape({ id: 'bottom', x: 0, y: 100, width: 100, height: 100 });
    const result = pathfinder(top, bottom, 'unite')!;

    expect(result.extra).toHaveLength(0);
    expect(result.element.x).toBeCloseTo(0, 3);
    expect(result.element.width).toBeCloseTo(100, 3);
    expect(result.element.height).toBeCloseTo(200, 3);
    expect(result.element.nodes!.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]);
  });

  it('preserves a contained subtraction as one even-odd compound path', () => {
    const inner = shape({ id: 'b', x: 10, y: 10, width: 20, height: 20 });
    const result = pathfinder(a, inner, 'subtract')!;

    expect(result.element.fillRule).toBe('evenodd');
    expect(result.element.subpaths).toHaveLength(2);
    expect(result.element.nodes).toEqual(result.element.subpaths![0]);
    expect(result.extra).toHaveLength(0);
  });

  it('returns null when the operation leaves nothing', () => {
    const inner = shape({ id: 'a', x: 10, y: 10, width: 20, height: 20 });
    expect(pathfinder(inner, a, 'subtract')).toBeNull();
  });
});

describe('pathfinderMany', () => {
  const at = (id: string, x: number, width = 100) => shape({ id, x, width });

  it('unites three overlapping shapes into one outline', () => {
    const result = pathfinderMany([at('a', 0), at('b', 50), at('c', 100)], 'unite')!;
    expect(result.extra).toHaveLength(0);
    expect(result.element.width).toBeCloseTo(200, 3);
  });

  it('keeps all five disjoint shapes as independent regions', () => {
    const elements = Array.from({ length: 5 }, (_, index) => at(`shape-${index}`, index * 200));
    const result = pathfinderMany(elements, 'unite')!;
    expect(result.extra).toHaveLength(4);
  });

  it('subtracts every front shape from the first in selection order', () => {
    const result = pathfinderMany([
      at('subject', 0, 200),
      at('left-cut', 0, 50),
      at('right-cut', 150, 50),
    ], 'subtract')!;
    expect(result.element.x).toBeCloseTo(50, 3);
    expect(result.element.width).toBeCloseTo(100, 3);
    expect(pathfinderMany([at('small', 0, 50), at('large', 0, 200)], 'subtract')).toBeNull();
  });

  it('intersects successively across three shapes', () => {
    const result = pathfinderMany([at('a', 0), at('b', 50), at('c', 75)], 'intersect')!;
    expect(result.element.x).toBeCloseTo(75, 3);
    expect(result.element.width).toBeCloseTo(25, 3);
  });

  it('excludes regions covered an even number of times across three shapes', () => {
    const result = pathfinderMany([at('a', 0), at('b', 50), at('c', 75)], 'exclude')!;
    expect(1 + result.extra.length).toBe(3);
    expect(result.element.x).toBeCloseTo(0, 3);
  });

  it('divides three shapes into unique non-duplicated regions', () => {
    const result = pathfinderMany([at('a', 0), at('b', 50), at('c', 100)], 'divide')!;
    expect(1 + result.extra.length).toBe(4);
  });

  it('keeps multiple contained subtractions in one even-odd path', () => {
    const result = pathfinderMany([
      at('outer', 0, 200),
      { ...at('left-hole', 25, 50), y: 25, height: 50 },
      { ...at('right-hole', 100, 50), y: 25, height: 50 },
    ], 'subtract')!;

    expect(result.element.fillRule).toBe('evenodd');
    expect(result.element.subpaths).toHaveLength(3);
    expect(result.extra).toHaveLength(0);
  });

  it.each(['intersect', 'exclude', 'divide'] as const)('supports contained geometry for %s', (op) => {
    const result = pathfinderMany([
      at('outer', 0, 200),
      at('inner', 50, 50),
    ], op)!;

    expect(result).toBeTruthy();
    expect(result.element.nodes!.length).toBeGreaterThan(0);
  });

  it('outlines every selected shape without fills', () => {
    const result = pathfinderMany([at('a', 0), at('b', 50), at('c', 100)], 'outline')!;
    expect(result.extra).toHaveLength(2);
    expect(result.element.fill).toBe('transparent');
    expect(result.element.stroke).toBe('#ff0000');
  });
});

describe('offsetElement', () => {
  it('grows the element and moves its origin out', () => {
    const patch = offsetElement(shape({}), 10)!;
    expect(patch.x).toBeCloseTo(-10, 3);
    expect(patch.width).toBeCloseTo(120, 3);
    expect(patch.type).toBe('path');
  });

  it('shrinks on a negative distance', () => {
    const patch = offsetElement(shape({}), -10)!;
    expect(patch.width).toBeCloseTo(80, 3);
  });
});

describe('offsetElement transforms', () => {
  it('offsets in local coordinates so rotation is not applied twice', () => {
    const patch = offsetElement(shape({ x: 40, y: 60, width: 100, height: 50, rotation: 90 }), 10)!;

    expect(patch.x).toBeCloseTo(30, 6);
    expect(patch.y).toBeCloseTo(50, 6);
    expect(patch.width).toBeCloseTo(120, 6);
    expect(patch.height).toBeCloseTo(70, 6);
    expect(patch.rotation).toBeUndefined();
  });
});

describe('roundElementCorners', () => {
  it('turns a rect into a path with bezier corners', () => {
    const patch = roundElementCorners(shape({}), 10)!;
    expect(patch.type).toBe('path');
    expect(patch.nodes!.length).toBe(8);
    expect(patch.nodes!.some((n) => typeof n.outX === 'number')).toBe(true);
  });

  it('leaves the element’s position alone — corners are a local edit', () => {
    const patch = roundElementCorners(shape({ x: 40, y: 60 }), 10)!;
    expect(patch.x).toBeUndefined();
    expect(Math.min(...patch.nodes!.map((n) => n.x))).toBeGreaterThanOrEqual(0);
  });

  it('rounds the local outline instead of rotating it a second time', () => {
    const patch = roundElementCorners(shape({ width: 100, height: 50, rotation: 90 }), 10)!;

    expect(Math.min(...patch.nodes!.map((n) => n.x))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...patch.nodes!.map((n) => n.x))).toBeLessThanOrEqual(100);
    expect(Math.min(...patch.nodes!.map((n) => n.y))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...patch.nodes!.map((n) => n.y))).toBeLessThanOrEqual(50);
  });
});
