/**
 * Polygon geometry for shape elements, shared by the Designer canvas and the
 * server renderer so a triangle drawn in the editor is the triangle that
 * exports.
 *
 * Every generator returns points in the element's LOCAL box space — origin at
 * the box's top-left, extending to `width` × `height`. Points are inscribed in
 * the box's ellipse, so a shape stretched into a wide box stretches with it.
 * (Konva's own `Star`/`RegularPolygon` take a single scalar radius and would
 * ignore `height` entirely, which is why these exist.)
 */

export interface ShapePoint {
  x: number;
  y: number;
}

/** Start at 12 o'clock so odd-sided polygons sit point-up, as users expect. */
const START_ANGLE = -Math.PI / 2;

const ellipsePoint = (
  width: number,
  height: number,
  angle: number
): ShapePoint => ({
  x: width / 2 + (width / 2) * Math.cos(angle),
  y: height / 2 + (height / 2) * Math.sin(angle),
});

export const DEFAULT_POLYGON_SIDES = 6;
export const DEFAULT_STAR_POINTS = 5;
export const DEFAULT_STAR_INNER_RATIO = 0.5;

/** A regular n-gon inscribed in the box. `sides` is clamped to 3–64. */
export const polygonPoints = (
  width: number,
  height: number,
  sides = DEFAULT_POLYGON_SIDES
): ShapePoint[] => {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const out: ShapePoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push(ellipsePoint(width, height, START_ANGLE + (i * 2 * Math.PI) / n));
  }
  return out;
};

/** Equilateral-ish triangle inscribed in the box — a 3-sided polygon. */
export const trianglePoints = (width: number, height: number): ShapePoint[] =>
  polygonPoints(width, height, 3);

/**
 * An n-pointed star inscribed in the box, alternating between the box ellipse
 * and an inner ellipse scaled by `innerRatio`.
 */
export const starPoints = (
  width: number,
  height: number,
  points = DEFAULT_STAR_POINTS,
  innerRatio = DEFAULT_STAR_INNER_RATIO
): ShapePoint[] => {
  const n = Math.max(3, Math.min(64, Math.round(points)));
  const ratio = Math.max(0.05, Math.min(0.95, innerRatio));
  const out: ShapePoint[] = [];
  for (let i = 0; i < n * 2; i++) {
    const angle = START_ANGLE + (i * Math.PI) / n;
    const outer = i % 2 === 0;
    const p = ellipsePoint(width, height, angle);
    out.push(
      outer
        ? p
        : {
            x: width / 2 + (p.x - width / 2) * ratio,
            y: height / 2 + (p.y - height / 2) * ratio,
          }
    );
  }
  return out;
};

/**
 * Points for whichever polygonal shape this element is, or null when the shape
 * isn't polygonal (rect / ellipse / line draw through their own primitives).
 */
export const pointsForShape = (
  shape: string | undefined,
  width: number,
  height: number,
  sides?: number,
  innerRatio?: number
): ShapePoint[] | null => {
  switch (shape) {
    case 'triangle':
      return trianglePoints(width, height);
    case 'polygon':
      return polygonPoints(width, height, sides ?? DEFAULT_POLYGON_SIDES);
    case 'star':
      return starPoints(
        width,
        height,
        sides ?? DEFAULT_STAR_POINTS,
        innerRatio ?? DEFAULT_STAR_INNER_RATIO
      );
    default:
      return null;
  }
};

/** Flatten to the `[x0, y0, x1, y1, …]` array Konva's `Line` expects. */
export const flattenPoints = (points: ShapePoint[]): number[] =>
  points.flatMap((p) => [p.x, p.y]);
