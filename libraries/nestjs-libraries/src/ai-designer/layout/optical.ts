import type { Box } from './box-model';

/**
 * The corrections that separate "mathematically centred" from "looks centred".
 *
 * Every one of these is a place where the arithmetic answer is visibly wrong to
 * a reader, which is why a layout engine alone does not produce work that looks
 * designed. They are small, and they are the difference.
 */

/**
 * Optical centring: a block sits slightly ABOVE the geometric centre.
 *
 * The eye reads the centre of a frame as higher than it is — a geometrically
 * centred block looks like it has slipped downward. Lifting it by a few percent
 * of the slack corrects that.
 *
 * The old composer had a version of this as `STACK_BALANCE_RATIO` fixed at 0.65
 * with a 0.15 cap. Generalised here so it applies to any centred box rather
 * than only to the copy stack.
 */
export const OPTICAL_CENTRE_LIFT = 0.06;

/** Never lift by more than this share of the container, however much slack. */
const MAX_LIFT_RATIO = 0.08;

export const opticallyCentre = (
  box: Box,
  container: Box,
  lift = OPTICAL_CENTRE_LIFT
): Box => {
  const slack = container.height - box.height;
  if (slack <= 0) return box;
  const geometric = container.y + slack / 2;
  const shift = Math.min(slack * lift, container.height * MAX_LIFT_RATIO);
  return { ...box, y: geometric - shift };
};

/**
 * Optical margin alignment (hanging punctuation).
 *
 * A line starting with a quotation mark looks indented, because the glyph is
 * mostly whitespace. Designers hang it into the margin. The overhang is a share
 * of the font size, per character class — approximate by nature, but the
 * approximation is far closer than zero.
 */
const OVERHANG: Record<string, number> = {
  '"': 0.28,
  "'": 0.28,
  '“': 0.32,
  '‘': 0.3,
  '”': 0.32,
  '’': 0.3,
  '(': 0.14,
  '[': 0.12,
  '—': 0.2,
  '–': 0.16,
  '-': 0.14,
  '«': 0.26,
  T: 0.04,
  V: 0.04,
  W: 0.04,
  Y: 0.05,
  A: 0.03,
};

/**
 * How far left a line should hang, in px, given its first character.
 *
 * Only ever applied to LEFT-aligned display type. Applied to body copy it makes
 * the first line look broken rather than the block look aligned, and applied to
 * centred type it means nothing at all.
 */
export const opticalOverhang = (text: string, fontSize: number): number => {
  const first = text.trimStart().charAt(0);
  if (!first) return 0;
  return (OVERHANG[first] ?? 0) * fontSize;
};

/**
 * Trim the space a font reserves above caps and below the baseline.
 *
 * A text box's height is the font's line box, which carries leading for
 * ascenders and descenders the copy may not use. Aligning that box flush to
 * another element leaves a gap that measures as zero and reads as a mistake.
 * Roughly 12% at the top and 8% at the bottom holds across the curated
 * families; it is a correction, not a measurement.
 */
export const capHeightTrim = (fontSize: number): { top: number; bottom: number } => ({
  top: fontSize * 0.12,
  bottom: fontSize * 0.08,
});

/**
 * Nudge a box so its visual edge, not its line box, sits on `edge`.
 *
 * Use when type must align with a rule, a panel edge or an image — the cases
 * where the gap is visible precisely because everything around it is exact.
 */
export const alignToCapHeight = (box: Box, fontSize: number): Box => ({
  ...box,
  y: box.y - capHeightTrim(fontSize).top,
});

/**
 * Whether two boxes are close enough that the gap between them reads as an
 * alignment error rather than as a deliberate space.
 *
 * Under about a third of a baseline the eye sees "not quite touching" instead
 * of "spaced", which looks like a bug in the design rather than a decision.
 */
export const isAwkwardGap = (gap: number, baseline: number): boolean =>
  gap > 0.01 && gap < baseline * 0.34;

/**
 * Collapse gaps that fall in the awkward band, closing them to flush.
 *
 * Deliberately closes rather than opens: a design that meant them to touch is
 * common, and one that meant a third-of-a-baseline gap is not.
 */
export const closeAwkwardGaps = (
  boxes: Box[],
  baseline: number
): Box[] => {
  const sorted = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => a.box.y - b.box.y);

  const out = boxes.slice();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].box;
    const cur = sorted[i].box;
    const gap = cur.y - (prev.y + prev.height);
    if (isAwkwardGap(gap, baseline)) {
      out[sorted[i].index] = { ...cur, y: prev.y + prev.height };
    }
  }
  return out;
};
