import { describe, it, expect } from 'vitest';
import {
  WARP_PRESETS,
  outlinePoints,
  warpOutline,
  warpPoint,
  warpedBounds,
  warpedOutline,
  warpPadding,
} from './warp';
import type { DesignerElement } from './designer-doc.schema';
import { applyLinked } from './apply-linked';

/**
 * Warp is non-destructive: the document keeps the shape's real geometry and
 * both renderers deform on the way out, the same contract text `curve` follows.
 * The load-bearing property here is that an element WITHOUT a warp comes back
 * null, so nothing that isn't warped changes by a pixel.
 */

const rect = (over: Partial<DesignerElement> = {}): DesignerElement =>
  ({
    id: 'r',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    ...over,
  }) as DesignerElement;

describe('warpPoint', () => {
  it('is the identity at zero bend', () => {
    expect(warpPoint(0.3, 0.7, { preset: 'arc', bend: 0 })).toEqual({ u: 0.3, v: 0.7 });
  });

  it('pins the ends and lifts the middle for an arc', () => {
    const spec = { preset: 'arc' as const, bend: 50 };
    expect(warpPoint(0, 0, spec).v).toBeCloseTo(0, 5);
    expect(warpPoint(1, 0, spec).v).toBeCloseTo(0, 5);
    // Positive bend arches upward, so the middle sits at a smaller v.
    expect(warpPoint(0.5, 0, spec).v).toBeLessThan(0);
  });

  it('reverses with the sign of the bend', () => {
    const up = warpPoint(0.5, 0, { preset: 'arc', bend: 50 }).v;
    const down = warpPoint(0.5, 0, { preset: 'arc', bend: -50 }).v;
    expect(up).toBeLessThan(0);
    expect(down).toBeGreaterThan(0);
    expect(up).toBeCloseTo(-down, 6);
  });

  it('moves only the top edge for arc-upper', () => {
    const spec = { preset: 'arc-upper' as const, bend: 50 };
    expect(warpPoint(0.5, 0, spec).v).toBeLessThan(0);
    // The bottom edge stays put.
    expect(warpPoint(0.5, 1, spec).v).toBeCloseTo(1, 5);
  });

  it('shears horizontally for a horizontal distortion', () => {
    const spec = { preset: 'arc' as const, bend: 0, distortH: 50 };
    expect(warpPoint(0.5, 0, spec).u).toBeLessThan(0.5);
    expect(warpPoint(0.5, 1, spec).u).toBeGreaterThan(0.5);
  });

  it('has a defined displacement for every listed preset', () => {
    for (const { value } of WARP_PRESETS) {
      const p = warpPoint(0.25, 0.25, { preset: value, bend: 60 });
      expect(Number.isFinite(p.u), `${value} u`).toBe(true);
      expect(Number.isFinite(p.v), `${value} v`).toBe(true);
    }
  });
});

describe('outlinePoints', () => {
  it('subdivides a rectangle so its straight edges can bend', () => {
    const points = outlinePoints(rect())!;
    expect(points.length).toBeGreaterThan(4);
    // Still a rectangle: every point sits on the box edge.
    for (const p of points) {
      const onEdge = p.x === 0 || p.x === 100 || p.y === 0 || p.y === 40;
      expect(onEdge).toBe(true);
    }
  });

  it('samples an ellipse', () => {
    const points = outlinePoints(rect({ shape: 'ellipse' }))!;
    expect(points.length).toBeGreaterThan(8);
    // Inscribed in the box.
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.x).toBeLessThanOrEqual(100.001);
    }
  });

  it('flattens a bezier path', () => {
    const points = outlinePoints({
      type: 'path',
      width: 100,
      height: 40,
      closed: false,
      nodes: [
        { x: 0, y: 0, outX: 30, outY: 40 },
        { x: 100, y: 0, inX: 70, inY: 40 },
      ],
    } as DesignerElement)!;
    expect(points.length).toBeGreaterThan(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('returns null for a zero-size element', () => {
    expect(outlinePoints(rect({ width: 0 }))).toBeNull();
  });

  it('returns null for an element that has no outline', () => {
    expect(outlinePoints(rect({ type: 'text' }))).toBeNull();
  });
});

describe('warpedOutline', () => {
  it('is null without a warp, so an unwarped shape renders as it always did', () => {
    expect(warpedOutline(rect())).toBeNull();
  });

  it('is null when a preset is remembered but every amount is zero', () => {
    expect(warpedOutline(rect({ warp: { preset: 'arc', bend: 0 } }))).toBeNull();
  });

  it('bows the outline out of its box', () => {
    const warped = warpedOutline(rect({ warp: { preset: 'arc', bend: 40 } }))!;
    const bounds = warpedBounds(warped)!;
    // Arched upward, so the outline reaches above the box top.
    expect(bounds.minY).toBeLessThan(0);
  });

  it('keeps the left and right extents of an arc', () => {
    const warped = warpedOutline(rect({ warp: { preset: 'arc', bend: 40 } }))!;
    const bounds = warpedBounds(warped)!;
    expect(bounds.minX).toBeCloseTo(0, 5);
    expect(bounds.maxX).toBeCloseTo(100, 5);
  });

  it('warps a path as readily as a shape', () => {
    const warped = warpedOutline({
      type: 'path',
      width: 100,
      height: 40,
      closed: false,
      nodes: [
        { x: 0, y: 20 },
        { x: 100, y: 20 },
      ],
      warp: { preset: 'arc', bend: 60 },
    } as DesignerElement);
    expect(warped).not.toBeNull();
    const bounds = warpedBounds(warped!)!;
    expect(bounds.minY).toBeLessThan(20);
  });
});

describe('warpOutline', () => {
  it('leaves points alone when the box has no size', () => {
    const points = [{ x: 1, y: 2 }];
    expect(warpOutline(points, 0, 10, { preset: 'arc', bend: 50 })).toBe(points);
  });
});

/**
 * A path stores its nodes in element-local coordinates, so resizing the element
 * has to carry the geometry with it. It used to move only the selection box,
 * and Konva hid that on the canvas by reporting the declared width/height for a
 * custom-`sceneFunc` shape — the mismatch showed up only in the export.
 */
describe('resizing a path', () => {
  const path = () =>
    ({
      id: 'p',
      type: 'path',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      nodes: [
        { x: 0, y: 0 },
        { x: 50, y: 40, inX: 25, inY: 20 },
        { x: 100, y: 0 },
      ],
    }) as DesignerElement;

  it('scales the nodes with the box', () => {
    const doc = {
      version: 4,
      mode: 'image',
      outputs: [
        { id: 'o', formatId: 'square', name: 'S', width: 200, height: 200, background: '#fff', children: [path()] },
      ],
    } as never;
    const { outputs } = applyLinked(doc, 0, ['p'], { width: 50, height: 20 }, true);
    const nodes = (outputs[0] as { children: DesignerElement[] }).children[0].nodes!;
    expect(nodes[2].x).toBe(50);
    expect(nodes[1].y).toBe(20);
    // Bezier handles ride along, or the curve tears away from its anchors.
    expect(nodes[1].inX).toBe(12.5);
  });

  it('leaves the nodes alone when only the position moves', () => {
    const doc = {
      version: 4,
      mode: 'image',
      outputs: [
        { id: 'o', formatId: 'square', name: 'S', width: 200, height: 200, background: '#fff', children: [path()] },
      ],
    } as never;
    const { outputs } = applyLinked(doc, 0, ['p'], { x: 30 }, true);
    const nodes = (outputs[0] as { children: DesignerElement[] }).children[0].nodes!;
    expect(nodes[2].x).toBe(100);
  });
});

/**
 * `warpedBounds` shipped with NO production caller — which is how a warped
 * banner's drop shadow came to be clipped at the element box on the canvas and
 * in the export alike. `warpPadding` is that caller.
 */
describe('warpPadding', () => {
  const banner = {
    type: 'shape' as const,
    shape: 'rect' as const,
    width: 400,
    height: 100,
  };

  it('is zero without a warp, so nothing pays for a feature it does not use', () => {
    expect(warpPadding(banner)).toBe(0);
    expect(warpPadding({ ...banner, warp: { preset: 'arc', bend: 0 } })).toBe(0);
  });

  it('grows with the bend', () => {
    const small = warpPadding({ ...banner, warp: { preset: 'arc', bend: 20 } });
    const large = warpPadding({ ...banner, warp: { preset: 'arc', bend: 80 } });
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  it('covers the overhang whichever way the bend goes', () => {
    for (const bend of [60, -60]) {
      const el = { ...banner, warp: { preset: 'arc' as const, bend } };
      const pad = warpPadding(el);
      const points = warpedOutline(el)!;
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(-pad - 1);
        expect(p.y).toBeGreaterThanOrEqual(-pad - 1);
        expect(p.x).toBeLessThanOrEqual(el.width + pad + 1);
        expect(p.y).toBeLessThanOrEqual(el.height + pad + 1);
      }
    }
  });
});
