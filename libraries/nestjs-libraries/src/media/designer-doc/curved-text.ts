/**
 * The arc a curved text element sits on.
 *
 * This was derived independently on each side and the two disagreed badly. The
 * canvas put the baseline at `y = radius` for a positive Arc Angle — roughly
 * 773px below a 400px-wide element, i.e. off the artboard entirely — while the
 * server always drew the same upward bow whatever the sign, so half the slider
 * did nothing there and the other half was off by a sagitta.
 *
 * One definition, used by both:
 *
 * - `curve` is the total subtended angle in DEGREES, which is what the slider
 *   is labelled and what the chord maths already assumed.
 * - A POSITIVE curve bows the text upward (∩), apex at the top of the box.
 * - A NEGATIVE curve bows it downward (∪), apex at the bottom.
 * - Either way the baseline occupies `0 … sagitta` vertically, so the text
 *   stays inside its own box instead of flying off.
 */

export interface ArcGeometry {
  /** Radius of the circle the baseline lies on. */
  radius: number;
  /** How far the apex rises above the chord — the arc's total height. */
  sagitta: number;
  /** True for a ∩ bow (positive curve), false for ∪. */
  up: boolean;
}

/**
 * Geometry for a `width`-wide element bowed by `curve` degrees, or null when
 * there is no curve to speak of (which both renderers treat as flat text).
 */
export const arcGeometry = (
  width: number,
  curve: number | undefined
): ArcGeometry | null => {
  const angle = Math.abs(curve ?? 0);
  if (!(angle > 0) || !(width > 0)) return null;
  const half = (angle * Math.PI) / 360;
  const radius = width / 2 / Math.sin(half);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return { radius, sagitta: radius * (1 - Math.cos(half)), up: (curve ?? 0) > 0 };
};

/**
 * Baseline offset at an angle from the arc's centre.
 *
 * `theta` is signed, running from `-half` at the left end to `+half` at the
 * right. Used by the server, which places one glyph at a time.
 */
export const arcBaselineY = (geometry: ArcGeometry, theta: number): number => {
  const rise = geometry.radius * (1 - Math.cos(theta));
  return geometry.up ? rise : geometry.sagitta - rise;
};

/**
 * Where the arc band sits inside an element of `height`.
 *
 * The band itself always spans `0 … sagitta` (see `arcBaselineY`), so a curved
 * line pinned there hugs the TOP of its box however it is vertically aligned —
 * which is how a badge's arched label floated clear off the plate it was
 * supposed to ride. Flat text has honoured `verticalAlign` all along.
 *
 * `top` (and an unset align) keeps the historical placement, so nothing that
 * never asked for centring moves. Both renderers apply this, so they cannot
 * drift apart.
 */
export const arcVerticalOffset = (
  geometry: ArcGeometry,
  height: number | undefined,
  verticalAlign: string | undefined
): number => {
  if (!height || !(height > 0)) return 0;
  const slack = height - geometry.sagitta;
  if (slack <= 0) return 0;
  if (verticalAlign === 'middle') return slack / 2;
  if (verticalAlign === 'bottom') return slack;
  return 0;
};

/**
 * The same arc as an SVG path, for Konva's `TextPath`.
 *
 * Sweep flag 1 draws in the positive-angle direction, which in SVG's y-down
 * space lifts the path as it travels left to right — so a ∩ is sweep 1 and a ∪
 * is sweep 0. (Verified against Konva's own path parser, which is what actually
 * walks this string.)
 */
export const arcPathData = (
  width: number,
  curve: number | undefined,
  height?: number,
  verticalAlign?: string
): string | null => {
  const geometry = arcGeometry(width, curve);
  if (!geometry) return null;
  const { radius, sagitta, up } = geometry;
  const edgeY =
    (up ? sagitta : 0) + arcVerticalOffset(geometry, height, verticalAlign);
  const sweep = up ? 1 : 0;
  const r = round(radius);
  return `M 0,${round(edgeY)} A ${r},${r} 0 0,${sweep} ${round(width)},${round(edgeY)}`;
};

const round = (n: number): number => Math.round(n * 1000) / 1000;
