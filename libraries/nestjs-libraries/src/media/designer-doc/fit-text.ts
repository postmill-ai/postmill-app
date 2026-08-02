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
  measure: MeasureText
): number => {
  if (!letterSpacing) return measure(line, fontSize);
  let w = 0;
  for (const ch of line) w += measure(ch, fontSize) + letterSpacing;
  return w;
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
  measure: MeasureText
): string[] => {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (
        measureLineWidth(candidate, fontSize, letterSpacing, measure) > maxWidth &&
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
}

export interface FittedText {
  fontSize: number;
  lines: string[];
  /** Per-line advance in px (already multiplied by the line-height factor). */
  lineHeight: number;
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
  const floor = Math.max(
    MIN_FIT_FONT_SIZE,
    Math.floor(box.fontSize * FIT_FLOOR_RATIO)
  );
  let size = box.fontSize;
  const wrapAt = (px: number) =>
    wrapTextLines(box.text, box.width, px, letterSpacing, measure);

  let lines = wrapAt(size);
  while (size > floor && lines.length * lineHeightFactor * size > box.height) {
    size = Math.max(floor, Math.floor(size * FIT_STEP_RATIO));
    lines = wrapAt(size);
  }
  return { fontSize: size, lines, lineHeight: lineHeightFactor * size };
};
