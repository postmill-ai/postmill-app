/**
 * Flat-text wrapping and shrink-to-fit, shared by the server-side renderer
 * (`design-render.service.ts`) and the Designer canvas (`elements.tsx`).
 *
 * Both surfaces must lay text out identically or the canvas and the exported
 * image disagree — that drift is exactly what this module exists to prevent.
 * The measurement primitive is injected so the caller can supply a node-canvas
 * context on the server and a DOM/Konva one in the browser; everything else
 * here is pure.
 */

/** Measures `text` as if it were painted at `fontSize`, ignoring letter spacing. */
export type MeasureText = (text: string, fontSize: number) => number;

/** Default line-height multiplier when an element doesn't specify one. */
export const DEFAULT_LINE_HEIGHT = 1.2;

/** Smallest font the shrink loop will ever return. */
export const MIN_FIT_FONT_SIZE = 8;

/** The shrink loop won't go below this fraction of the authored size. */
export const FIT_FLOOR_RATIO = 0.6;

/** Each shrink step multiplies the current size by this. */
export const FIT_STEP_RATIO = 0.9;

/**
 * Width of one line, applying `letterSpacing` per character the same way the
 * renderer paints it (spacing is added *after* every character, including the
 * last — matching `drawTextLine`).
 */
export const measureLineWidth = (
  line: string,
  fontSize: number,
  letterSpacing: number,
  measure: MeasureText,
  scaleX = 1
): number => {
  // The single definition of what a horizontal scale does to tracking: layout
  // is measured in unscaled glyph space and the whole line is scaled, so
  // condensing the glyphs condenses the spacing between them too.
  if (!letterSpacing) return measure(line, fontSize) * scaleX;
  let w = 0;
  for (const ch of line) w += measure(ch, fontSize) + letterSpacing;
  return w * scaleX;
};

/**
 * Greedy word wrap at `maxWidth`. Explicit `\n` always breaks; a single word
 * wider than the box is never split (it overflows on its own line), which is
 * what the renderer has always done.
 */
export const wrapTextLines = (
  text: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number,
  measure: MeasureText,
  scaleX = 1
): string[] => {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (
        measureLineWidth(candidate, fontSize, letterSpacing, measure, scaleX) > maxWidth &&
        current
      ) {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    out.push(current);
  }
  return out;
};

/**
 * Case transform, applied BEFORE measurement.
 *
 * It has to live here rather than in either renderer: uppercasing text changes
 * how wide it is, so a transform applied at paint time would wrap at the wrong
 * words and shrink-to-fit against the wrong measurement. One implementation,
 * ahead of the wrap, is the only version that can't disagree with itself.
 */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export const applyTextTransform = (
  text: string,
  transform: TextTransform | undefined
): string => {
  switch (transform) {
    case 'uppercase':
      return text.toLocaleUpperCase();
    case 'lowercase':
      return text.toLocaleLowerCase();
    case 'capitalize':
      // Per word, and only the first letter — the rest is left alone, so an
      // intentional "iPhone" survives.
      return text.replace(/(^|\s)(\S)/g, (_, lead, ch) => lead + ch.toLocaleUpperCase());
    default:
      return text;
  }
};

export interface FitTextBox {
  text: string;
  /** Wrap width — the element box width. */
  width: number;
  /** Box height the wrapped block must fit inside. */
  height: number;
  /** Authored font size; the fitted result is never larger than this. */
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  /** Horizontal scale; condensed text fits more per line. Defaults to 1. */
  scaleX?: number;
  /** Applied before wrapping, because case changes the measurement. */
  textTransform?: TextTransform;
  /**
   * Absolute floor for the shrink loop, overriding the default
   * `max(8, 60% of authored)`. The AI composer's role floors are absolute
   * pixel values; without this it could not reuse the shared fitter.
   */
  minFontSize?: number;
  /** Extra leading before each paragraph after the first, in px. */
  paragraphSpacing?: number;
  /** First-line indent of each paragraph, in px. */
  firstLineIndent?: number;
}

export interface FittedText {
  fontSize: number;
  lines: string[];
  /** Per-line advance in px (already multiplied by the line-height factor). */
  lineHeight: number;
  /**
   * Extra leading ABOVE each line, index-aligned with `lines` — paragraph
   * spacing, which only applies to the first line of a new paragraph. All
   * zeroes when no paragraph spacing is set, so the common case is unchanged.
   */
  lineGaps: number[];
  /** Left indent per line, index-aligned with `lines`. */
  lineIndents: number[];
}

/**
 * Wrap `text` at `width`, then step the font down 10% at a time — floored at
 * 60% of the authored size, or 8px, whichever is larger — until the wrapped
 * block fits `height`. Text is only ever shrunk, never grown: the authored
 * `fontSize` is the ceiling.
 */
export const fitTextToBox = (
  box: FitTextBox,
  measure: MeasureText
): FittedText => {
  const lineHeightFactor = box.lineHeight || DEFAULT_LINE_HEIGHT;
  const letterSpacing = box.letterSpacing || 0;
  const floor =
    box.minFontSize !== undefined
      ? Math.max(1, Math.floor(box.minFontSize))
      : Math.max(MIN_FIT_FONT_SIZE, Math.floor(box.fontSize * FIT_FLOOR_RATIO));
  let size = box.fontSize;
  const scaleX = box.scaleX || 1;
  const paragraphSpacing = box.paragraphSpacing || 0;
  const indent = box.firstLineIndent || 0;
  // Case first: it changes the width of every word, so wrapping the untransformed
  // text and uppercasing at paint time would break at the wrong places.
  const text = applyTextTransform(box.text, box.textTransform);

  // Which wrapped lines START a paragraph — the only ones paragraph spacing and
  // a first-line indent apply to. Derived per wrap, since the wrap changes.
  const paragraphStarts = (lines: string[]): boolean[] => {
    if (!paragraphSpacing && !indent) return lines.map(() => false);
    const counts = text
      .split('\n')
      .map((p) => wrapTextLines(p, box.width - indent, size, letterSpacing, measure, scaleX).length);
    const starts = lines.map(() => false);
    let at = 0;
    for (const count of counts) {
      if (at < starts.length) starts[at] = true;
      at += count;
    }
    return starts;
  };

  const wrapAt = (px: number) =>
    wrapTextLines(text, box.width - indent, px, letterSpacing, measure, scaleX);

  const blockHeight = (lines: string[], px: number): number => {
    const base = lines.length * lineHeightFactor * px;
    if (!paragraphSpacing) return base;
    // The first paragraph gets no space above it.
    const extra = paragraphStarts(lines).filter(Boolean).length - 1;
    return base + Math.max(0, extra) * paragraphSpacing;
  };

  let lines = wrapAt(size);
  while (size > floor && blockHeight(lines, size) > box.height) {
    size = Math.max(floor, Math.floor(size * FIT_STEP_RATIO));
    lines = wrapAt(size);
  }

  const starts = paragraphStarts(lines);
  return {
    fontSize: size,
    lines,
    lineHeight: lineHeightFactor * size,
    lineGaps: starts.map((start, i) => (start && i > 0 ? paragraphSpacing : 0)),
    lineIndents: starts.map((start) => (start ? indent : 0)),
  };
};
