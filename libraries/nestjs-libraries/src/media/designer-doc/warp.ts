import type { DesignerElement } from './designer-doc.schema';
import { pathBounds } from './path-geometry';
import { pointsForShape, type ShapePoint } from './shape-geometry';

/**
 * Warp presets for shapes and paths, shared by the Designer canvas and the
 * server renderer so an arched banner exports as the banner you drew.
 *
 * Warp is NON-DESTRUCTIVE, like text `curve`: the document keeps the shape's
 * real geometry and both renderers deform it on the way to the screen. That
 * means a warp can be dialled back to zero without having lost anything.
 *
 * Every preset is a displacement of normalised (u, v) coordinates, where u runs
 * 0…1 left to right and v runs 0…1 top to bottom of the element box — the same
 * local box space `shape-geometry` works in.
 *
 * Photoshop's Fisheye and Twist need a full 2D mesh rather than a per-point
 * displacement and are deliberately absent; everything here can be evaluated
 * one point at a time, which is what lets the same function serve a polyline,
 * a bezier outline and a server-side trace.
 */

export type WarpPreset =
  | 'arc'
  | 'arc-lower'
  | 'arc-upper'
  | 'arch'
  | 'bulge'
  | 'shell-lower'
  | 'shell-upper'
  | 'flag'
  | 'wave'
  | 'rise'
  | 'fish';

export interface WarpSpec {
  preset: WarpPreset;
  /** −100…100, Photoshop's Bend. 0 is no deformation at all. */
  bend?: number;
  /** −100…100 horizontal distortion (perspective along x). */
  distortH?: number;
  /** −100…100 vertical distortion (perspective along y). */
  distortV?: number;
}

export const WARP_PRESETS: { value: WarpPreset; label: string }[] = [
  { value: 'arc', label: 'Arc' },
  { value: 'arc-lower', label: 'Arc Lower' },
  { value: 'arc-upper', label: 'Arc Upper' },
  { value: 'arch', label: 'Arch' },
  { value: 'bulge', label: 'Bulge' },
  { value: 'shell-lower', label: 'Shell Lower' },
  { value: 'shell-upper', label: 'Shell Upper' },
  { value: 'flag', label: 'Flag' },
  { value: 'wave', label: 'Wave' },
  { value: 'rise', label: 'Rise' },
  { value: 'fish', label: 'Fish' },
];

/** How finely a straight edge is subdivided so it has points to bend with. */
export const WARP_SEGMENTS = 24;

/**
 * Displace one normalised point.
 *
 * `u`/`v` in 0…1; the result is in the same space, and may leave 0…1 — a warp
 * legitimately pushes geometry outside its original box, which is why callers
 * re-measure the bounds afterwards.
 */
export const warpPoint = (
  u: number,
  v: number,
  spec: WarpSpec
): { u: number; v: number } => {
  const bend = (spec.bend ?? 0) / 100;
  const dh = (spec.distortH ?? 0) / 100;
  const dv = (spec.distortV ?? 0) / 100;

  // Centred coordinates make the symmetric presets fall out naturally.
  const cu = u - 0.5;
  // A parabola that is 0 at the edges and 1 in the middle.
  const hump = 1 - 4 * cu * cu;

  let du = 0;
  let dv2 = 0;

  switch (spec.preset) {
    case 'arc':
      // The whole band curves; both edges ride the same arc.
      dv2 = -bend * hump * 0.5;
      break;
    case 'arc-upper':
      // Only the top edge moves.
      dv2 = -bend * hump * 0.5 * (1 - v);
      break;
    case 'arc-lower':
      // Only the bottom edge moves.
      dv2 = -bend * hump * 0.5 * v;
      break;
    case 'arch':
      // Like arc, but the deformation eases towards the bottom.
      dv2 = -bend * hump * 0.5 * (1 - v * 0.5);
      break;
    case 'bulge':
      // Edges bow outward from the centre line.
      dv2 = bend * hump * 0.5 * (v - 0.5) * 2;
      break;
    case 'shell-upper':
      dv2 = -bend * hump * 0.5 * (1 - v) - bend * 0.1 * (1 - v);
      break;
    case 'shell-lower':
      dv2 = bend * hump * 0.5 * v + bend * 0.1 * v;
      break;
    case 'rise':
      // A slope rather than a curve: one end lifts.
      dv2 = -bend * u * 0.5;
      break;
    case 'flag':
      // A full sine along the band, the whole height moving together.
      dv2 = -bend * Math.sin(u * Math.PI * 2) * 0.25;
      break;
    case 'wave':
      // Like flag, but the top and bottom edges travel out of phase.
      dv2 =
        -bend * Math.sin(u * Math.PI * 2) * 0.25 * (1 - v) +
        bend * Math.sin(u * Math.PI * 2 + Math.PI) * 0.25 * v;
      break;
    case 'fish':
      // Widens towards one end.
      dv2 = bend * u * (v - 0.5);
      break;
    default:
      break;
  }

  // Distortion is a shear that grows towards the far edge — Photoshop's
  // Horizontal/Vertical Distortion sliders, which read as perspective.
  du += dh * (v - 0.5);
  dv2 += dv * (u - 0.5);

  return { u: u + du, v: v + dv2 };
};

/** Apply a warp to a point list in element-local box space. */
export const warpOutline = (
  points: ShapePoint[],
  width: number,
  height: number,
  spec: WarpSpec
): ShapePoint[] => {
  if (!width || !height) return points;
  return points.map((p) => {
    const warped = warpPoint(p.x / width, p.y / height, spec);
    return { x: warped.u * width, y: warped.v * height };
  });
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Walk a straight edge, so it has enough points to actually bend. */
const subdivide = (
  from: ShapePoint,
  to: ShapePoint,
  segments: number
): ShapePoint[] => {
  const out: ShapePoint[] = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    out.push({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) });
  }
  return out;
};

const cubicAt = (
  p0: number,
  c0: number,
  c1: number,
  p1: number,
  t: number
): number => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * c0 + 3 * mt * t * t * c1 + t * t * t * p1;
};

/**
 * A polyline outline for any warpable element, in local box space.
 *
 * Rects and ellipses have no point list of their own (they draw through Konva
 * primitives), and a bezier path has too few, so everything is resampled to a
 * common density — a straight edge with two points cannot bend.
 *
 * Returns null for anything that has no outline to warp.
 */
export const outlinePoints = (
  el: Pick<
    DesignerElement,
    'type' | 'shape' | 'width' | 'height' | 'sides' | 'innerRatio' | 'nodes' | 'closed'
  >,
  segments = WARP_SEGMENTS
): ShapePoint[] | null => {
  const { width, height } = el;
  if (!(width > 0) || !(height > 0)) return null;

  if (el.type === 'path') {
    const nodes = el.nodes || [];
    if (nodes.length < 2) return null;
    const out: ShapePoint[] = [];
    const last = el.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < last; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const c0x = a.outX ?? a.x;
      const c0y = a.outY ?? a.y;
      const c1x = b.inX ?? b.x;
      const c1y = b.inY ?? b.y;
      for (let s = 0; s < segments; s++) {
        const t = s / segments;
        out.push({
          x: cubicAt(a.x, c0x, c1x, b.x, t),
          y: cubicAt(a.y, c0y, c1y, b.y, t),
        });
      }
    }
    if (!el.closed) out.push({ x: nodes[nodes.length - 1].x, y: nodes[nodes.length - 1].y });
    return out;
  }

  if (el.type !== 'shape') return null;

  const polygonal = pointsForShape(el.shape, width, height, el.sides, el.innerRatio);
  if (polygonal) {
    // Already a point list, but its edges are straight — resample them.
    const out: ShapePoint[] = [];
    for (let i = 0; i < polygonal.length; i++) {
      out.push(...subdivide(polygonal[i], polygonal[(i + 1) % polygonal.length], Math.max(2, Math.round(segments / 4))));
    }
    return out;
  }

  if (el.shape === 'ellipse') {
    const out: ShapePoint[] = [];
    const steps = segments * 4;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      out.push({
        x: width / 2 + (width / 2) * Math.cos(angle),
        y: height / 2 + (height / 2) * Math.sin(angle),
      });
    }
    return out;
  }

  if (el.shape === 'line') {
    return subdivide({ x: 0, y: 0 }, { x: width, y: height }, segments).concat({
      x: width,
      y: height,
    });
  }

  // rect, and anything that falls back to one.
  const corners: ShapePoint[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const out: ShapePoint[] = [];
  for (let i = 0; i < corners.length; i++) {
    out.push(...subdivide(corners[i], corners[(i + 1) % corners.length], segments));
  }
  return out;
};

/**
 * The warped outline of an element, or null when it has no warp or nothing to
 * warp. This is the single entry point both renderers call.
 */
export const warpedOutline = (
  el: Pick<
    DesignerElement,
    'type' | 'shape' | 'width' | 'height' | 'sides' | 'innerRatio' | 'nodes' | 'closed' | 'warp'
  >,
  segments = WARP_SEGMENTS
): ShapePoint[] | null => {
  const spec = el.warp;
  if (!spec?.preset) return null;
  // A zero bend with no distortion is the identity; skip the whole path so an
  // element that merely remembers a preset renders exactly as before.
  if (!spec.bend && !spec.distortH && !spec.distortV) return null;
  const points = outlinePoints(el, segments);
  if (!points) return null;
  return warpOutline(points, el.width, el.height, spec);
};

/** Bounds of a warped outline, for callers that need the grown box. */
export const warpedBounds = (points: ShapePoint[]) =>
  pathBounds(points.map((p) => ({ x: p.x, y: p.y })));

/**
 * How far a warp pushes past the element box, in design units.
 *
 * Both renderers draw warp correctly and NOTHING ELSE knew the geometry leaves
 * the rect — `warpedBounds` had no production caller at all, which is what gave
 * it away. The offscreen buffers that carry layer effects are sized from the
 * element rect, so an arched banner's drop shadow was sliced off at the box on
 * the canvas and again in the export. This is the slack they need.
 *
 * One number for all four sides: the buffers pad symmetrically, and a warp that
 * bulges 40px up and 5px down still only needs one buffer.
 */
export const warpPadding = (
  el: Pick<
    DesignerElement,
    'type' | 'shape' | 'width' | 'height' | 'sides' | 'innerRatio' | 'nodes' | 'closed' | 'warp'
  >
): number => {
  const points = warpedOutline(el);
  if (!points) return 0;
  const bounds = warpedBounds(points);
  return Math.ceil(
    Math.max(
      -bounds.minX,
      -bounds.minY,
      bounds.maxX - el.width,
      bounds.maxY - el.height,
      0
    )
  );
};
