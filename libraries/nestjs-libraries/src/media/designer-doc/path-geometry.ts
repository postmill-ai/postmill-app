/**
 * Bezier path geometry for `path` elements, shared by the Designer canvas and
 * the server renderer.
 *
 * Paths are the one thing the Pen tools produce, and unlike brush strokes they
 * are fully deterministic on both sides — the same node list traced with the
 * same canvas2d calls yields the same pixels. That is why paths stay vectors in
 * the document while painted pixels have to be flattened to an uploaded bitmap.
 *
 * Coordinates are element-LOCAL: `(0,0)` is the element's top-left, extending
 * to `width` × `height`. Control handles are absolute local points, not offsets
 * from their anchor — offsets read nicely but make every edit a two-step
 * conversion.
 */

export interface DesignerPathNode {
  x: number;
  y: number;
  /** Incoming control point (governs the curve arriving at this anchor). */
  inX?: number;
  inY?: number;
  /** Outgoing control point (governs the curve leaving this anchor). */
  outX?: number;
  outY?: number;
}

/** Minimal 2D context surface — satisfied by both node-canvas and Konva. */
export interface PathTraceContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ): void;
  closePath(): void;
}

const hasOut = (n: DesignerPathNode) =>
  typeof n.outX === 'number' && typeof n.outY === 'number';
const hasIn = (n: DesignerPathNode) =>
  typeof n.inX === 'number' && typeof n.inY === 'number';

/**
 * Trace one segment. A segment is a straight line only when NEITHER endpoint
 * contributes a handle; otherwise the missing handle collapses onto its own
 * anchor, which is what makes a single-handle node produce a proper curve.
 */
const traceSegment = (
  ctx: PathTraceContext,
  from: DesignerPathNode,
  to: DesignerPathNode
): void => {
  if (!hasOut(from) && !hasIn(to)) {
    ctx.lineTo(to.x, to.y);
    return;
  }
  ctx.bezierCurveTo(
    hasOut(from) ? (from.outX as number) : from.x,
    hasOut(from) ? (from.outY as number) : from.y,
    hasIn(to) ? (to.inX as number) : to.x,
    hasIn(to) ? (to.inY as number) : to.y,
    to.x,
    to.y
  );
};

/** Trace the whole path into `ctx`. Callers fill/stroke afterwards. */
export const tracePathNodes = (
  ctx: PathTraceContext,
  nodes: DesignerPathNode[],
  closed = false
): void => {
  if (!nodes.length) return;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 0; i < nodes.length - 1; i++) {
    traceSegment(ctx, nodes[i], nodes[i + 1]);
  }
  // A 2-node path can be closed too (the Pen tool allows it) — match
  // `svg-export`, which closes for any count, or canvas and SVG diverge.
  if (closed && nodes.length >= 2) {
    traceSegment(ctx, nodes[nodes.length - 1], nodes[0]);
    ctx.closePath();
  }
};

export interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box over anchors AND handles.
 *
 * Using the handles rather than sampling the curve overestimates slightly (a
 * bezier stays inside its control hull), but it is exact for the common cases,
 * never clips the shape, and costs nothing.
 */
export const pathBounds = (nodes: DesignerPathNode[]): PathBounds | null => {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of nodes) {
    visit(n.x, n.y);
    if (hasIn(n)) visit(n.inX as number, n.inY as number);
    if (hasOut(n)) visit(n.outX as number, n.outY as number);
  }
  return { minX, minY, maxX, maxY };
};

/** Shift every point by (dx, dy), handles included. */
export const translatePathNodes = (
  nodes: DesignerPathNode[],
  dx: number,
  dy: number
): DesignerPathNode[] =>
  nodes.map((n) => ({
    x: n.x + dx,
    y: n.y + dy,
    ...(hasIn(n) ? { inX: (n.inX as number) + dx, inY: (n.inY as number) + dy } : {}),
    ...(hasOut(n) ? { outX: (n.outX as number) + dx, outY: (n.outY as number) + dy } : {}),
  }));

/** Scale every point about the local origin, handles included. */
export const scalePathNodes = (
  nodes: DesignerPathNode[],
  sx: number,
  sy: number
): DesignerPathNode[] =>
  nodes.map((n) => ({
    x: n.x * sx,
    y: n.y * sy,
    ...(hasIn(n) ? { inX: (n.inX as number) * sx, inY: (n.inY as number) * sy } : {}),
    ...(hasOut(n) ? { outX: (n.outX as number) * sx, outY: (n.outY as number) * sy } : {}),
  }));

/**
 * Rotate every point about (cx, cy) by `degrees` (Konva's convention:
 * positive is clockwise in the canvas's y-down space), handles included.
 * The one way to rotate a canvas-box path (absolute nodes) rigidly with the
 * rest of its unit — setting `rotation` on the element would swing the
 * whole-canvas box about its origin instead.
 */
export const rotatePathNodes = (
  nodes: DesignerPathNode[],
  cx: number,
  cy: number,
  degrees: number
): DesignerPathNode[] => {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (x: number, y: number) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  });
  return nodes.map((n) => {
    const p = rot(n.x, n.y);
    const i = hasIn(n) ? rot(n.inX as number, n.inY as number) : undefined;
    const o = hasOut(n) ? rot(n.outX as number, n.outY as number) : undefined;
    return {
      x: p.x,
      y: p.y,
      ...(i ? { inX: i.x, inY: i.y } : {}),
      ...(o ? { outX: o.x, outY: o.y } : {}),
    };
  });
};

/**
 * Re-origin a node list built in DOCUMENT space into element-local space,
 * returning the element box that contains it. Every Pen tool ends here, so the
 * stored nodes are always local and the element box always hugs the path.
 */
export const normalisePathToBox = (
  nodes: DesignerPathNode[]
): { nodes: DesignerPathNode[]; x: number; y: number; width: number; height: number } | null => {
  const b = pathBounds(nodes);
  if (!b) return null;
  return {
    nodes: translatePathNodes(nodes, -b.minX, -b.minY),
    x: b.minX,
    y: b.minY,
    // A perfectly straight horizontal or vertical path has zero extent on one
    // axis; keep it non-zero so the element stays selectable and transformable.
    width: Math.max(1, b.maxX - b.minX),
    height: Math.max(1, b.maxY - b.minY),
  };
};

/**
 * Smooth handles for a polyline, Catmull-Rom style — the Curvature Pen's whole
 * trick: the user clicks anchors and the curve is inferred.
 */
export const smoothPathNodes = (
  nodes: DesignerPathNode[],
  closed = false,
  tension = 1 / 3
): DesignerPathNode[] => {
  const n = nodes.length;
  if (n < 2) return nodes.map((p) => ({ x: p.x, y: p.y }));

  return nodes.map((cur, i) => {
    const prev = nodes[i === 0 ? (closed ? n - 1 : 0) : i - 1];
    const next = nodes[i === n - 1 ? (closed ? 0 : n - 1) : i + 1];
    const dx = (next.x - prev.x) * tension;
    const dy = (next.y - prev.y) * tension;
    return {
      x: cur.x,
      y: cur.y,
      inX: cur.x - dx,
      inY: cur.y - dy,
      outX: cur.x + dx,
      outY: cur.y + dy,
    };
  });
};

/**
 * Ramer–Douglas–Peucker simplification, used by the Freeform Pen to turn a
 * dense pointer trail into a handful of anchors.
 */
export const simplifyPoints = (
  points: { x: number; y: number }[],
  tolerance = 2
): { x: number; y: number }[] => {
  if (points.length < 3) return points.slice();

  const sqTol = tolerance * tolerance;
  const sqSegDist = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ) => {
    let x = a.x, y = a.y;
    let dx = b.x - x, dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.x; y = b.y; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x; dy = p.y - y;
    return dx * dx + dy * dy;
  };

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxSq = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) { index = i; maxSq = sq; }
    }
    if (maxSq > sqTol) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
};
