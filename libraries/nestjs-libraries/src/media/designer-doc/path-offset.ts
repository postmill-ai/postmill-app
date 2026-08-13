/**
 * Offset Path and Live Corners.
 *
 * Offsetting grows or shrinks a closed outline by a fixed distance — the
 * operation behind Illustrator's Offset Path, and the one that turns a shape
 * into a border of itself. Corners are rounded at a fixed radius rather than
 * mitred, because a mitred offset spikes to infinity at a sharp angle.
 */

import type { DesignerPathNode } from './path-geometry';
import { flattenPath, polygonArea, polygonToNodes, type Point } from './path-boolean';

const EPS = 1e-9;

const normal = (a: Point, b: Point): Point | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  // Left-hand normal; the winding check below decides which way is "out".
  return { x: -dy / len, y: dx / len };
};

const lineIntersection = (
  p1: Point,
  d1: Point,
  p2: Point,
  d2: Point
): Point | null => {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-7) return null; // parallel: the edges are collinear
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
};

/**
 * Offset a closed polygon outwards by `distance` (negative shrinks it).
 *
 * Each edge is pushed along its normal and the neighbours re-intersected. A
 * pair of edges that has become parallel — which happens when a shrink
 * collapses a feature — falls back to the pushed point instead of dividing by
 * a vanishing denominator.
 */
export const offsetPolygon = (poly: Point[], distance: number): Point[] => {
  if (poly.length < 3 || Math.abs(distance) < EPS) return poly;

  // The left normal points INTO a positively-wound ring (y grows downwards in
  // canvas space), so the sign has to follow the winding or "outset" would
  // shrink half the shapes people draw.
  const sign = polygonArea(poly) >= 0 ? -1 : 1;
  const d = distance * sign;

  const edges: { p: Point; dir: Point }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const n = normal(a, b);
    if (!n) continue;
    edges.push({
      p: { x: a.x + n.x * d, y: a.y + n.y * d },
      dir: { x: b.x - a.x, y: b.y - a.y },
    });
  }
  if (edges.length < 3) return poly;

  const out: Point[] = [];
  for (let i = 0; i < edges.length; i++) {
    const prev = edges[(i - 1 + edges.length) % edges.length];
    const cur = edges[i];
    const hit = lineIntersection(prev.p, prev.dir, cur.p, cur.dir);
    out.push(hit || cur.p);
  }

  if (out.length < 3) return poly;

  // A shrink that went past the shape's own medial axis turns the ring inside
  // out — and an inverted square keeps its winding, so the give-away is the
  // AREA moving the wrong way rather than the sign flipping.
  const before = Math.abs(polygonArea(poly));
  const after = Math.abs(polygonArea(out));
  if (polygonArea(out) * polygonArea(poly) <= 0) return poly;
  if (distance < 0 && after >= before) return poly;
  if (distance > 0 && after <= before) return poly;
  return out;
};

export const offsetPath = (
  nodes: DesignerPathNode[],
  distance: number
): DesignerPathNode[] => polygonToNodes(offsetPolygon(flattenPath(nodes), distance));

/**
 * Round every corner of a path to `radius`, Illustrator's Live Corners.
 *
 * The corner anchor is replaced by two anchors pulled back along its own edges,
 * joined by a bezier whose handles sit at the old corner — the standard circular
 * approximation, and the one that matches what `roundRect` draws.
 */
export const roundCorners = (
  nodes: DesignerPathNode[],
  radius: number
): DesignerPathNode[] => {
  const poly = flattenPath(nodes);
  if (poly.length < 3 || radius <= 0) return nodes;

  const out: DesignerPathNode[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const cur = poly[i];
    const next = poly[(i + 1) % poly.length];

    const toPrev = { x: prev.x - cur.x, y: prev.y - cur.y };
    const toNext = { x: next.x - cur.x, y: next.y - cur.y };
    const lenPrev = Math.hypot(toPrev.x, toPrev.y);
    const lenNext = Math.hypot(toNext.x, toNext.y);
    if (lenPrev < EPS || lenNext < EPS) {
      out.push({ x: cur.x, y: cur.y });
      continue;
    }

    // Never eat more than half an edge, or neighbouring corners overlap and
    // the path folds back on itself.
    const r = Math.min(radius, lenPrev / 2, lenNext / 2);
    const a = { x: cur.x + (toPrev.x / lenPrev) * r, y: cur.y + (toPrev.y / lenPrev) * r };
    const b = { x: cur.x + (toNext.x / lenNext) * r, y: cur.y + (toNext.y / lenNext) * r };

    out.push({ x: a.x, y: a.y, outX: cur.x, outY: cur.y });
    out.push({ x: b.x, y: b.y, inX: cur.x, inY: cur.y });
  }
  return out;
};
