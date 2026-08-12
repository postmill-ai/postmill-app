import {
  applyTextTransform,
  type TextTransform,
} from '../../../media/designer-doc/fit-text';
import type { MeasureText } from '../../../media/designer-doc/fit-text';

/**
 * Real glyph advances for the layout pass.
 *
 * The composer has always estimated text as `length × fontSize × 0.56` — one
 * constant for every family, so Anton (heavily condensed) and Playfair Display
 * (wide, high-contrast) were assumed identical. That estimate decides where
 * lines break, which decides how tall a copy block is, which decides whether it
 * fits. It is why copy overflows and the vision critic spends rounds asking for
 * geometry nudges that a correct measurement would never have needed.
 *
 * The layout engine is pure and synchronous, and it must stay that way — the
 * whole compose path is synchronous below `_composeDeterministic`, and making
 * measurement async there would ripple through every caller and force a canvas
 * into every layout spec.
 *
 * So this is the only async part: load the fonts, build a canvas context, and
 * hand back a SYNCHRONOUS measure function. One await, at the top.
 */

/** What the old approximation assumed for every family at every weight. */
const FALLBACK_ADVANCE_RATIO = 0.56;

/** The approximation, kept as the degraded path rather than as the default. */
export const approximateAdvance = (text: string, fontSize: number): number =>
  text.length * fontSize * FALLBACK_ADVANCE_RATIO;

export interface FontSpec {
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
}

/**
 * Measures a string at a size in a specific face.
 *
 * Wider than `MeasureText` (which fixes the face) because one layout mixes a
 * display family and a body family, and the difference between them is exactly
 * what the old single constant threw away.
 */
export type FaceMeasurer = (
  text: string,
  fontSize: number,
  font?: FontSpec
) => number;

/** Bind a face, producing the narrower signature `fit-text` expects. */
export const forFace = (measure: FaceMeasurer, font?: FontSpec): MeasureText =>
  (text, fontSize) => measure(text, fontSize, font);

const fontKey = (font: FontSpec | undefined, fontSize: number) =>
  `${font?.fontStyle || 'normal'} ${font?.fontWeight || 400} ${Math.round(fontSize)}px ${
    font?.fontFamily || 'sans-serif'
  }`;

/**
 * A family name no font can be registered under, used to measure what the
 * platform's fallback face does. Anything measuring the same as this is not
 * actually available.
 */
const UNAVAILABLE_FACE = '__postmill_no_such_face__';

/** Mixed widths, ascenders, descenders and digits, so two genuinely different
 * faces are very unlikely to agree on the total advance by accident. */
const PROBE_TEXT = 'MWiljq019 @#gyq';

/**
 * Build a measurer backed by node-canvas.
 *
 * Falls back to the approximation rather than throwing when the native binary
 * is missing or a family failed to load: the composer runs in environments
 * where canvas may not be built, and a design laid out with estimated metrics
 * is very much better than no design.
 *
 * A family that was never REGISTERED is the sharper trap, and it took CI to
 * expose it: node-canvas silently substitutes the platform's default sans, so
 * the composer measured DejaVu on Linux and Helvetica on macOS while believing
 * it had Anton. The same golden geometry therefore came out 36px wider in CI
 * than on a developer's machine, and — worse than any snapshot — a CTA plate
 * was sized for a face the renderer would never paint, which is how labels
 * came back clipped mid-glyph.
 *
 * So availability is PROBED per face: a family that measures exactly like a
 * family that cannot exist is treated as absent, and its text falls back to
 * the documented estimate. Real metrics when the face is really there, one
 * stated approximation when it is not, and never a third answer that depends
 * on which machine composed the design.
 */
export const createTextMeasurer = async (
  loadFonts?: () => Promise<void>
): Promise<FaceMeasurer> => {
  let ctx: { font: string; measureText(t: string): { width: number } } | null = null;

  try {
    if (loadFonts) await loadFonts();
    const { createCanvas } = await import('canvas');
    // 1x1: nothing is drawn, only measured. The context carries the font state.
    ctx = createCanvas(1, 1).getContext('2d') as unknown as typeof ctx;
  } catch {
    ctx = null;
  }

  if (!ctx) return (text, fontSize) => approximateAdvance(text, fontSize);

  const context = ctx;
  // Setting `ctx.font` and measuring is not free, and a layout measures the
  // same headline at the same size repeatedly as the engine tries widths.
  const cache = new Map<string, number>();
  const available = new Map<string, boolean>();

  const probe = (family: string, font: FontSpec | undefined): number => {
    context.font = fontKey({ ...font, fontFamily: family }, 100);
    return context.measureText(PROBE_TEXT).width;
  };

  /** Is this face registered, or is node-canvas quietly substituting? */
  const faceIsReal = (font: FontSpec | undefined): boolean => {
    const family = font?.fontFamily?.trim();
    if (!family) return false;
    const key = `${font?.fontStyle || 'normal'} ${font?.fontWeight || 400} ${family}`;
    const hit = available.get(key);
    if (hit !== undefined) return hit;
    let real = false;
    try {
      real = probe(family, font) !== probe(UNAVAILABLE_FACE, font);
    } catch {
      real = false;
    }
    available.set(key, real);
    return real;
  };

  return (text, fontSize, font) => {
    if (!text) return 0;
    const key = `${fontKey(font, fontSize)}\0${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    let width: number;
    if (!faceIsReal(font)) {
      width = approximateAdvance(text, fontSize);
    } else {
      try {
        context.font = fontKey(font, fontSize);
        width = context.measureText(text).width;
      } catch {
        width = approximateAdvance(text, fontSize);
      }
    }
    // A family that failed to register measures as the fallback face, which is
    // silently wrong rather than obviously wrong. Zero is the one result that
    // cannot be right for non-empty text.
    if (!(width > 0)) width = approximateAdvance(text, fontSize);

    cache.set(key, width);
    return width;
  };
};

/**
 * Estimated word-wrap line count for a flat text at `fontSize` inside `width`
 * px — deliberately pessimistic (0.55 × fontSize per glyph) so callers err on
 * the small side. The DEGRADED path only: anything with a live measurer uses
 * `fitTextToBox` on real glyph advances instead.
 *
 * One copy, transform-aware. This existed three times (composer, badge fit,
 * doc-validator), and none of them measured the string the renderer would
 * actually paint once case became a render property.
 */
export const estimateWrappedLines = (
  text: string,
  width: number,
  fontSize: number,
  textTransform?: TextTransform
): number => {
  const t = applyTextTransform(text, textTransform);
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  let lines = 1;
  let current = 0;
  for (const word of t.split(/\s+/)) {
    const wordLen = Math.max(1, word.length);
    if (current > 0 && current + 1 + wordLen > maxChars) {
      lines++;
      current = 0;
    }
    current = current > 0 ? current + 1 + wordLen : wordLen;
    // A single word longer than the line is assumed to hard-wrap mid-word —
    // a height-estimate convenience only; the renderer never splits a word.
    while (current > maxChars) {
      lines++;
      current -= maxChars;
    }
  }
  return lines;
};
