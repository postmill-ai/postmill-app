import { describe, it, expect } from 'vitest';
import { elementOutline, offsetElement, pathfinder, roundElementCorners } from './pathfinder';
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

  it('rejects a subtract that would punch a hole the path model cannot express', () => {
    const inner = shape({ id: 'b', x: 10, y: 10, width: 20, height: 20 });
    // clip wholly inside the subject → [subject, clip] rings, a hole.
    expect(pathfinder(a, inner, 'subtract')).toBeNull();
  });

  it('returns null when the operation leaves nothing', () => {
    const inner = shape({ id: 'a', x: 10, y: 10, width: 20, height: 20 });
    expect(pathfinder(inner, a, 'subtract')).toBeNull();
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
});
