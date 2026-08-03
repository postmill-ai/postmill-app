/**
 * Illustrator-grade stroke options, and the arrowheads canvas has no notion of.
 *
 * The first five settings (dash, dash offset, cap, join, miter limit) map
 * straight onto both Konva and canvas2d, so they cost nothing beyond passing
 * them through. Arrowheads do not exist in either, so they are traced here as
 * a small path and drawn by all three renderers from this one source.
 */

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';
export type ArrowHead = 'none' | 'arrow' | 'triangle' | 'circle' | 'square' | 'bar';

export interface StrokeStyle {
  /** Dash pattern in px, e.g. `[8, 4]`. Empty or absent = solid. */
  dash?: number[];
  dashOffset?: number;
  lineCap?: LineCap;
  lineJoin?: LineJoin;
  miterLimit?: number;
  arrowStart?: ArrowHead;
  arrowEnd?: ArrowHead;
}

export interface Point {
  x: number;
  y: number;
}

/** An arrowhead is drawn this many times the stroke width. */
export const ARROW_SCALE = 4;
export const MIN_ARROW_SIZE = 4;

export const arrowSize = (strokeWidth: number): number =>
  Math.max(MIN_ARROW_SIZE, (strokeWidth || 1) * ARROW_SCALE);

/**
 * The polygon of an arrowhead sitting at `tip`, pointing along `angle`.
 *
 * Returned in absolute coordinates so every renderer just fills the points —
 * no transform stack to get subtly wrong in three places. `circle` is returned
 * as a polygon too, for the same reason.
 */
export const arrowHeadPoints = (
  head: ArrowHead,
  tip: Point,
  angleRad: number,
  strokeWidth: number
): Point[] => {
  if (!head || head === 'none') return [];
  const size = arrowSize(strokeWidth);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  // Local space: the tip is at the origin and the shaft runs in −x.
  const at = (lx: number, ly: number): Point => ({
    x: tip.x + lx * cos - ly * sin,
    y: tip.y + lx * sin + ly * cos,
  });

  switch (head) {
    case 'arrow':
      // A concave barb — the shape a pen draws, not a plain triangle.
      return [at(0, 0), at(-size, size * 0.45), at(-size * 0.7, 0), at(-size, -size * 0.45)];
    case 'triangle':
      return [at(0, 0), at(-size, size * 0.45), at(-size, -size * 0.45)];
    case 'square': {
      const h = size * 0.4;
      return [at(h, h), at(h, -h), at(-h, -h), at(-h, h)];
    }
    case 'bar': {
      const h = size * 0.5;
      const w = Math.max(1, strokeWidth * 0.5);
      return [at(w, h), at(w, -h), at(-w, -h), at(-w, h)];
    }
    case 'circle': {
      const r = size * 0.4;
      const points: Point[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        points.push(at(Math.cos(a) * r, Math.sin(a) * r));
      }
      return points;
    }
    default:
      return [];
  }
};

/**
 * How far to pull the shaft back so it does not poke out of a solid head.
 *
 * A `bar` or `circle` straddles the endpoint rather than extending from it, so
 * they inset nothing — trimming there would leave a visible gap.
 */
export const arrowInset = (head: ArrowHead, strokeWidth: number): number => {
  if (!head || head === 'none' || head === 'bar' || head === 'circle') return 0;
  const size = arrowSize(strokeWidth);
  return head === 'arrow' ? size * 0.7 : size;
};

/** The direction of the line at an endpoint, in radians. */
export const endpointAngle = (from: Point, to: Point): number =>
  Math.atan2(to.y - from.y, to.x - from.x);

/**
 * The stroke's endpoints and their directions, for a polyline.
 *
 * Returns null for anything with fewer than two distinct points: an arrowhead
 * on a zero-length line has no direction to point in, and guessing one puts it
 * at a random angle.
 */
export const strokeEndpoints = (
  points: Point[]
): { start: Point; startAngle: number; end: Point; endAngle: number } | null => {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];

  // Walk in from each end until the neighbour is a different place.
  let second = points[1];
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i].x - first.x, points[i].y - first.y) > 1e-6) {
      second = points[i];
      break;
    }
  }
  let penultimate = points[points.length - 2];
  for (let i = points.length - 2; i >= 0; i--) {
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) > 1e-6) {
      penultimate = points[i];
      break;
    }
  }
  if (
    Math.hypot(second.x - first.x, second.y - first.y) < 1e-6 ||
    Math.hypot(last.x - penultimate.x, last.y - penultimate.y) < 1e-6
  ) {
    return null;
  }

  return {
    start: first,
    // The start head points BACK along the line, away from the shaft.
    startAngle: endpointAngle(second, first),
    end: last,
    endAngle: endpointAngle(penultimate, last),
  };
};

/** Move a point `distance` along `angle` — used to inset the shaft. */
export const along = (p: Point, angleRad: number, distance: number): Point => ({
  x: p.x + Math.cos(angleRad) * distance,
  y: p.y + Math.sin(angleRad) * distance,
});

/** These same functions as JavaScript source, for the injected frame renderer. */
export const strokeStyleSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const ARROW_SCALE = ${ARROW_SCALE};`,
    `const MIN_ARROW_SIZE = ${MIN_ARROW_SIZE};`,
    decl('arrowSize', arrowSize),
    decl('arrowHeadPoints', arrowHeadPoints),
    decl('arrowInset', arrowInset),
    decl('endpointAngle', endpointAngle),
    decl('strokeEndpoints', strokeEndpoints),
    decl('along', along),
  ].join('\n');
};
