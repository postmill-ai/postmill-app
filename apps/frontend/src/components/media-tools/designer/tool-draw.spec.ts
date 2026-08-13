import {
  rectFromDrag,
  isMeaningfulDraw,
  shapeForTool,
  buildShapeElement,
  MIN_DRAW_SIZE,
} from './tool-draw';
import {
  polygonPoints,
  starPoints,
  trianglePoints,
  pointsForShape,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/shape-geometry';

const at = (x: number, y: number) => ({ x, y });

describe('rectFromDrag', () => {
  it('builds a rect from a top-left to bottom-right drag', () => {
    expect(rectFromDrag(at(10, 20), at(40, 60))).toEqual({
      x: 10, y: 20, width: 30, height: 40,
    });
  });

  it('normalises a drag that goes up and to the left', () => {
    expect(rectFromDrag(at(40, 60), at(10, 20))).toEqual({
      x: 10, y: 20, width: 30, height: 40,
    });
  });

  it('constrains to a square with Shift, in the drag direction', () => {
    // Wider than tall: the square takes the larger extent.
    expect(rectFromDrag(at(0, 0), at(50, 20), { shift: true })).toEqual({
      x: 0, y: 0, width: 50, height: 50,
    });
    // Dragging up-left still yields a positive rect anchored correctly.
    expect(rectFromDrag(at(100, 100), at(50, 80), { shift: true })).toEqual({
      x: 50, y: 50, width: 50, height: 50,
    });
  });

  it('draws from the centre with Alt', () => {
    expect(rectFromDrag(at(50, 50), at(70, 60), { alt: true })).toEqual({
      x: 30, y: 40, width: 40, height: 20,
    });
  });

  it('combines Shift and Alt into a centred square', () => {
    expect(rectFromDrag(at(50, 50), at(70, 55), { shift: true, alt: true })).toEqual({
      x: 30, y: 30, width: 40, height: 40,
    });
  });

  it('yields a zero rect for a click without movement', () => {
    const r = rectFromDrag(at(10, 10), at(10, 10));
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
    expect(isMeaningfulDraw(r)).toBe(false);
  });

  it('treats a drag past the threshold on either axis as meaningful', () => {
    expect(isMeaningfulDraw({ x: 0, y: 0, width: MIN_DRAW_SIZE, height: 0 })).toBe(true);
    expect(isMeaningfulDraw({ x: 0, y: 0, width: 0, height: MIN_DRAW_SIZE })).toBe(true);
    expect(isMeaningfulDraw({ x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });
});

describe('shapeForTool', () => {
  it('maps each shape tool to its shape', () => {
    expect(shapeForTool('shape-rect')).toBe('rect');
    expect(shapeForTool('shape-ellipse')).toBe('ellipse');
    expect(shapeForTool('shape-triangle')).toBe('triangle');
    expect(shapeForTool('shape-polygon')).toBe('polygon');
    expect(shapeForTool('shape-star')).toBe('star');
    expect(shapeForTool('shape-line')).toBe('line');
  });

  it('falls back to a rect for unknown ids', () => {
    expect(shapeForTool('nonsense')).toBe('rect');
  });
});

describe('buildShapeElement', () => {
  const rect = { x: 5, y: 6, width: 100, height: 50 };

  it('builds a filled rect', () => {
    const el = buildShapeElement('shape-rect', rect);
    expect(el).toMatchObject({ type: 'shape', shape: 'rect', x: 5, y: 6, width: 100, height: 50 });
    expect(el.fill).toBeTruthy();
  });

  it('gives a line a stroke and no fill, and allows a flat box', () => {
    // A line is its box's diagonal, so a purely horizontal drag must survive
    // rather than collapse to an unselectable zero-size element.
    const el = buildShapeElement('shape-line', { x: 0, y: 0, width: 80, height: 0 });
    expect(el.shape).toBe('line');
    expect(el.fill).toBeUndefined();
    expect(el.stroke).toBeTruthy();
    expect(el.height).toBe(0);
    expect(el.width).toBe(80);
  });

  it('carries polygon sides and star points from the options bar', () => {
    expect(buildShapeElement('shape-polygon', rect, { sides: 8 }).sides).toBe(8);
    const star = buildShapeElement('shape-star', rect, { points: 7, innerRatio: 40 });
    expect(star.sides).toBe(7);
    expect(star.innerRatio).toBeCloseTo(0.4);
  });

  it('applies a corner radius only when set', () => {
    expect(buildShapeElement('shape-rect', rect, { cornerRadius: 12 }).borderRadius).toBe(12);
    expect(buildShapeElement('shape-rect', rect, { cornerRadius: 0 }).borderRadius).toBeUndefined();
  });

  it('never emits a zero-width box', () => {
    const el = buildShapeElement('shape-rect', { x: 0, y: 0, width: 0, height: 0 });
    expect(el.width).toBeGreaterThan(0);
    expect(el.height).toBeGreaterThan(0);
  });
});

describe('shape geometry', () => {
  it('inscribes a triangle in the box, point up', () => {
    const pts = trianglePoints(100, 100);
    expect(pts).toHaveLength(3);
    // First point sits at 12 o'clock.
    expect(pts[0].x).toBeCloseTo(50);
    expect(pts[0].y).toBeCloseTo(0);
  });

  it('stretches with a non-square box instead of ignoring height', () => {
    // This is the bug the shared generator exists to fix: Konva's Star and
    // RegularPolygon take one scalar radius, so a 200x50 box would render a
    // circle-inscribed shape. Note a vertex-up hexagon does NOT touch the left
    // and right edges (its x-span is √3/2 of the width), so the invariant to
    // assert is proportionality, not edge contact.
    const wide = polygonPoints(200, 50, 6);
    const half = polygonPoints(100, 50, 6);
    const span = (pts: { x: number; y: number }[], axis: 'x' | 'y') =>
      Math.max(...pts.map((p) => p[axis])) - Math.min(...pts.map((p) => p[axis]));

    // Doubling the width doubles the horizontal span and leaves height alone.
    expect(span(wide, 'x')).toBeCloseTo(span(half, 'x') * 2);
    expect(span(wide, 'y')).toBeCloseTo(span(half, 'y'));
    // A vertex sits at the very top and bottom, so the height IS fully used.
    expect(span(wide, 'y')).toBeCloseTo(50);
    // And the shape stays centred in its box.
    expect(Math.min(...wide.map((p) => p.x)) + Math.max(...wide.map((p) => p.x))).toBeCloseTo(200);
  });

  it('clamps the side count to a drawable range', () => {
    expect(polygonPoints(10, 10, 1)).toHaveLength(3);
    expect(polygonPoints(10, 10, 999)).toHaveLength(64);
  });

  it('alternates outer and inner radii for a star', () => {
    const pts = starPoints(100, 100, 5, 0.5);
    expect(pts).toHaveLength(10);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50);
    expect(dist(pts[0])).toBeCloseTo(50);
    expect(dist(pts[1])).toBeCloseTo(25);
  });

  it('returns null for shapes drawn by their own primitive', () => {
    expect(pointsForShape('rect', 10, 10)).toBeNull();
    expect(pointsForShape('ellipse', 10, 10)).toBeNull();
    expect(pointsForShape('line', 10, 10)).toBeNull();
  });
});
