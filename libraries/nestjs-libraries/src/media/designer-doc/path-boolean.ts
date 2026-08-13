/**
 * Pathfinder: boolean operations on `path` and `shape` elements.
 *
 * Beziers are flattened to polygons first and the result comes back as
 * straight-segment path nodes. That is a deliberate trade — an exact bezier
 * boolean is a research problem, and a flattened result traces identically in
 * all three renderers, which is the property that matters here. The flattening
 * tolerance is fine enough that the difference is sub-pixel at normal zoom.
 */

import type { DesignerPathNode } from './path-geometry';

export type BooleanOp =
  | 'unite'
  | 'subtract'
  | 'intersect'
  | 'exclude'
  | 'divide'
  | 'outline';

export interface Point {
  x: number;
  y: number;
}

/** Segments per bezier when flattening. 24 is sub-pixel for a 1000px curve. */
const FLATTEN_STEPS = 24;
const EPS = 1e-9;

const hasOut = (n: DesignerPathNode) =>
  typeof n.outX === 'number' && typeof n.outY === 'number';
const hasIn = (n: DesignerPathNode) =>
  typeof n.inX === 'number' && typeof n.inY === 'number';

/** Flatten a closed node ring to a polygon, dropping coincident points. */
export const flattenPath = (
  nodes: DesignerPathNode[],
  steps = FLATTEN_STEPS
): Point[] => {
  if (nodes.length < 2) return nodes.map((n) => ({ x: n.x, y: n.y }));
  const out: Point[] = [];
  const push = (p: Point) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) out.push(p);
  };

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    push({ x: a.x, y: a.y });
    if (!hasOut(a) && !hasIn(b)) continue;
    const c1 = hasOut(a) ? { x: a.outX as number, y: a.outY as number } : { x: a.x, y: a.y };
    const c2 = hasIn(b) ? { x: b.inX as number, y: b.inY as number } : { x: b.x, y: b.y };
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      });
    }
  }

  // A ring's first and last point are the same place; keep one.
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) out.pop();
  }
  return out;
};

/** Turn a polygon back into straight-segment path nodes. */
export const polygonToNodes = (points: Point[]): DesignerPathNode[] =>
  points.map((p) => ({ x: p.x, y: p.y }));

export const polygonArea = (poly: Point[]): number => {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

/** Even-odd containment. Points exactly on an edge count as inside. */
export const pointInPolygon = (p: Point, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || EPS) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

interface Vertex {
  x: number;
  y: number;
  /** Parameter along its own source edge, for ordering inserted crossings. */
  alpha: number;
  intersect: boolean;
  entry: boolean;
  visited: boolean;
  neighbour: number; // index into the other ring
}

const segmentIntersection = (
  a: Point,
  b: Point,
  c: Point,
  d: Point
): { alpha: number; beta: number; point: Point } | null => {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null; // parallel or collinear

  const alpha = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const beta = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  // Strictly inside both segments: an endpoint crossing is a degeneracy that
  // Greiner–Hormann cannot label, and nudging is what keeps it from producing
  // a self-crossing result.
  if (alpha <= EPS || alpha >= 1 - EPS || beta <= EPS || beta >= 1 - EPS) return null;

  return {
    alpha,
    beta,
    point: { x: a.x + alpha * rx, y: a.y + alpha * ry },
  };
};

const buildRing = (poly: Point[]): Vertex[] =>
  poly.map((p) => ({
    x: p.x,
    y: p.y,
    alpha: 0,
    intersect: false,
    entry: false,
    visited: false,
    neighbour: -1,
  }));

/**
 * Greiner–Hormann clipping.
 *
 * Returns null when the two rings do not cross at all, because the answer is
 * then a containment question the caller answers rather than a traversal — and
 * a traversal of a non-intersecting pair silently returns nothing.
 */
const clipRings = (
  subject: Point[],
  clip: Point[],
  subjectEntry: boolean,
  clipEntry: boolean
): Point[][] | null => {
  const s = buildRing(subject);
  const c = buildRing(clip);

  // Insert crossings into both rings, keeping each edge's crossings ordered.
  const sInsert: { index: number; vertices: Vertex[] }[] = [];
  const cInsert: { index: number; vertices: Vertex[] }[] = [];
  for (let i = 0; i < subject.length; i++) sInsert.push({ index: i, vertices: [] });
  for (let j = 0; j < clip.length; j++) cInsert.push({ index: j, vertices: [] });

  let crossings = 0;
  for (let i = 0; i < subject.length; i++) {
    const a = subject[i];
    const b = subject[(i + 1) % subject.length];
    for (let j = 0; j < clip.length; j++) {
      const cc = clip[j];
      const d = clip[(j + 1) % clip.length];
      const hit = segmentIntersection(a, b, cc, d);
      if (!hit) continue;
      crossings++;
      const sv: Vertex = {
        x: hit.point.x, y: hit.point.y, alpha: hit.alpha,
        intersect: true, entry: false, visited: false, neighbour: -1,
      };
      const cv: Vertex = {
        x: hit.point.x, y: hit.point.y, alpha: hit.beta,
        intersect: true, entry: false, visited: false, neighbour: -1,
      };
      sInsert[i].vertices.push(sv);
      cInsert[j].vertices.push(cv);
      // Paired by identity below, once both lists are flattened.
      (sv as Vertex & { pair?: Vertex }).pair = cv;
      (cv as Vertex & { pair?: Vertex }).pair = sv;
    }
  }

  if (crossings === 0) return null;

  const flatten = (
    ring: Vertex[],
    inserts: { index: number; vertices: Vertex[] }[]
  ): Vertex[] => {
    const out: Vertex[] = [];
    for (let i = 0; i < ring.length; i++) {
      out.push(ring[i]);
      const extra = [...inserts[i].vertices].sort((p, q) => p.alpha - q.alpha);
      out.push(...extra);
    }
    return out;
  };

  const sFlat = flatten(s, sInsert);
  const cFlat = flatten(c, cInsert);

  const indexOfPair = (v: Vertex, list: Vertex[]) =>
    list.indexOf((v as Vertex & { pair?: Vertex }).pair as Vertex);
  for (const v of sFlat) if (v.intersect) v.neighbour = indexOfPair(v, cFlat);
  for (const v of cFlat) if (v.intersect) v.neighbour = indexOfPair(v, sFlat);

  // Entry/exit labelling: alternates around each ring from whether the ring's
  // start lies inside the other.
  let inside = pointInPolygon(sFlat[0], clip);
  for (const v of sFlat) {
    if (!v.intersect) continue;
    v.entry = subjectEntry ? !inside : inside;
    inside = !inside;
  }
  inside = pointInPolygon(cFlat[0], subject);
  for (const v of cFlat) {
    if (!v.intersect) continue;
    v.entry = clipEntry ? !inside : inside;
    inside = !inside;
  }

  const results: Point[][] = [];
  for (let start = 0; start < sFlat.length; start++) {
    if (!sFlat[start].intersect || sFlat[start].visited) continue;

    const piece: Point[] = [];
    let onSubject = true;
    let index = start;
    let guard = 0;
    const limit = (sFlat.length + cFlat.length) * 4;

    do {
      const ring = onSubject ? sFlat : cFlat;
      const v = ring[index];
      v.visited = true;
      if (onSubject) {
        const pairIndex = v.neighbour;
        if (pairIndex >= 0) cFlat[pairIndex].visited = true;
      } else {
        const pairIndex = v.neighbour;
        if (pairIndex >= 0) sFlat[pairIndex].visited = true;
      }

      const forward = v.entry;
      let cursor = index;
      do {
        cursor = forward
          ? (cursor + 1) % ring.length
          : (cursor - 1 + ring.length) % ring.length;
        piece.push({ x: ring[cursor].x, y: ring[cursor].y });
        ring[cursor].visited = true;
        if (++guard > limit) break;
      } while (!ring[cursor].intersect);

      if (guard > limit) break;
      index = ring[cursor].neighbour;
      onSubject = !onSubject;
      if (index < 0) break;
    } while (!(onSubject && index === start) && guard <= limit);

    if (piece.length >= 3) results.push(piece);
  }

  return results.length ? results : null;
};

export interface BooleanResult {
  /** One entry per resulting subpath. `divide` is the only op that returns many. */
  polygons: Point[][];
}

/**
 * Run a pathfinder operation on two closed polygons.
 *
 * Non-intersecting and degenerate inputs have defined answers rather than a
 * crash or an empty result: a shape that misses entirely still unites into two
 * subpaths, and subtracting something that does not touch returns the original.
 */
export const booleanPolygons = (
  subject: Point[],
  clip: Point[],
  op: BooleanOp
): BooleanResult => {
  const valid = subject.length >= 3 && clip.length >= 3;
  if (!valid) {
    // An open or degenerate input has no interior to reason about. A
    // degenerate CLIP leaves the subject untouched; a degenerate SUBJECT has
    // no interior, so intersect/subtract empty out but the ops that keep
    // geometry still return the valid clip — dropping it would silently
    // delete a shape from the document.
    if (subject.length >= 3) return { polygons: [subject] };
    if (clip.length >= 3 && (op === 'unite' || op === 'exclude' || op === 'divide' || op === 'outline')) {
      return { polygons: [clip] };
    }
    return { polygons: [] };
  }

  if (op === 'outline') {
    // Outline keeps the boundaries and discards the fills — every ring survives.
    return { polygons: [subject, clip] };
  }

  const subjectInClip = pointInPolygon(subject[0], clip);
  const clipInSubject = pointInPolygon(clip[0], subject);

  const disjoint = (): BooleanResult => {
    switch (op) {
      case 'unite':
        if (subjectInClip) return { polygons: [clip] };
        if (clipInSubject) return { polygons: [subject] };
        return { polygons: [subject, clip] };
      case 'intersect':
        if (subjectInClip) return { polygons: [subject] };
        if (clipInSubject) return { polygons: [clip] };
        return { polygons: [] };
      case 'subtract':
        if (subjectInClip) return { polygons: [] };
        // A hole: the clip sits wholly inside, so both rings are kept and the
        // even-odd fill rule punches it out.
        if (clipInSubject) return { polygons: [subject, clip] };
        return { polygons: [subject] };
      case 'exclude':
        return { polygons: [subject, clip] };
      case 'divide':
        if (subjectInClip) return { polygons: [subject] };
        if (clipInSubject) return { polygons: [clip, subject] };
        return { polygons: [subject, clip] };
      default:
        return { polygons: [subject] };
    }
  };

  switch (op) {
    case 'intersect': {
      const r = clipRings(subject, clip, true, true);
      return r ? { polygons: r } : disjoint();
    }
    case 'unite': {
      const r = clipRings(subject, clip, false, false);
      return r ? { polygons: r } : disjoint();
    }
    case 'subtract': {
      const r = clipRings(subject, clip, false, true);
      return r ? { polygons: r } : disjoint();
    }
    case 'exclude': {
      const a = clipRings(subject, clip, false, true);
      const b = clipRings(clip, subject, false, true);
      const polygons = [...(a || []), ...(b || [])];
      return polygons.length ? { polygons } : disjoint();
    }
    case 'divide': {
      const inter = clipRings(subject, clip, true, true);
      const aMinusB = clipRings(subject, clip, false, true);
      const bMinusA = clipRings(clip, subject, false, true);
      const polygons = [
        ...(aMinusB || []),
        ...(bMinusA || []),
        ...(inter || []),
      ];
      return polygons.length ? { polygons } : disjoint();
    }
    default:
      return { polygons: [subject] };
  }
};

/** The same operation stated in path nodes, which is what elements carry. */
export const booleanPaths = (
  subject: DesignerPathNode[],
  clip: DesignerPathNode[],
  op: BooleanOp
): DesignerPathNode[][] =>
  booleanPolygons(flattenPath(subject), flattenPath(clip), op).polygons.map(
    polygonToNodes
  );
