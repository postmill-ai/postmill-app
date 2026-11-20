import type { TextRun } from './designer-doc.schema';

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
   * Absolute floor for the shrink loop. Legacy fitting defaults to
   * `max(8, 60% of authored)`; opt-in auto-fit defaults to 8px. The AI
   * composer's role floors are absolute pixel values.
   */
  minFontSize?: number;
  /** Extra leading before each paragraph after the first, in px. */
  paragraphSpacing?: number;
  /** First-line indent of each paragraph, in px. */
  firstLineIndent?: number;
  /** Rich-run alignment; flat alignment is applied by the renderer. */
  align?: 'left' | 'center' | 'right' | 'justify';
  /**
   * True fits both dimensions; false disables shrinking. Undefined retains the
   * legacy height-only behavior so existing documents render unchanged.
   */
  autoFit?: boolean;
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
  /**
   * Which wrapped lines START a paragraph, index-aligned with `lines` — even
   * when no paragraph spacing or indent is set, so justify can leave every
   * paragraph's LAST line at its natural spacing.
   */
  paragraphStarts: boolean[];
}

/**
 * Wrap `text` at `width`. Legacy/absent auto-fit steps down 10% at a time to
 * the legacy 60%/8px floor for height; explicit true also fits line widths and
 * defaults to the absolute 8px floor; explicit false keeps the authored size.
 * Text is only ever shrunk, never grown: `fontSize` is always the ceiling.
 */
export const fitTextToBox = (
  box: FitTextBox,
  measure: MeasureText
): FittedText => {
  const lineHeightFactor = box.lineHeight || DEFAULT_LINE_HEIGHT;
  const letterSpacing = box.letterSpacing || 0;
  const requestedFloor =
    box.minFontSize !== undefined
      ? Math.max(1, Math.floor(box.minFontSize))
      : box.autoFit === true
      ? MIN_FIT_FONT_SIZE
      : Math.max(MIN_FIT_FONT_SIZE, Math.floor(box.fontSize * FIT_FLOOR_RATIO));
  const floor = Math.min(box.fontSize, requestedFloor);
  let size = box.fontSize;
  const scaleX = box.scaleX || 1;
  const paragraphSpacing = box.paragraphSpacing || 0;
  const indent = box.firstLineIndent || 0;
  // Case first: it changes the width of every word, so wrapping the untransformed
  // text and uppercasing at paint time would break at the wrong places.
  const text = applyTextTransform(box.text, box.textTransform);

  // Which wrapped lines START a paragraph — the only ones paragraph spacing and
  // a first-line indent apply to, and the ones justify uses to leave every
  // paragraph's LAST line at natural spacing. Derived per wrap, since the wrap
  // changes.
  const paragraphStarts = (lines: string[]): boolean[] => {
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

  const overflows = (lines: string[], px: number): boolean => {
    if (blockHeight(lines, px) > box.height) return true;
    if (box.autoFit !== true) return false;
    const available = Math.max(1, box.width - indent);
    return lines.some(
      (line) => measureLineWidth(line, px, letterSpacing, measure, scaleX) > available
    );
  };

  let lines = wrapAt(size);
  while (box.autoFit !== false && size > floor && overflows(lines, size)) {
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
    paragraphStarts: starts,
  };
};

export type ResolvedTextRun = TextRun & { fontSize: number };
export type MeasureRichRun = (text: string, run: ResolvedTextRun) => number;

export interface RichTextLayoutOptions {
  width: number;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
}

export interface RichTextSegment {
  text: string;
  x: number;
  y: number;
  width: number;
  run: ResolvedTextRun;
  lineIndex: number;
  endsParagraph: boolean;
}

export interface RichTextLine {
  segments: RichTextSegment[];
  y: number;
  width: number;
  height: number;
  endsParagraph: boolean;
}

export interface RichTextLayout {
  runs: ResolvedTextRun[];
  lines: RichTextLine[];
  segments: RichTextSegment[];
  fontSize: number;
  height: number;
}

export interface FittedRichText extends RichTextLayout {
  fits: boolean;
}

const measureRichRunWidth = (
  text: string,
  run: ResolvedTextRun,
  letterSpacing: number,
  measure: MeasureRichRun
): number => {
  if (!letterSpacing) return measure(text, run);
  let width = 0;
  for (const ch of text) width += measure(ch, run) + letterSpacing;
  return width;
};

export const layoutRichText = (
  runs: TextRun[],
  options: RichTextLayoutOptions,
  measure: MeasureRichRun
): RichTextLayout => {
  const resolvedRuns = runs.map((run) => ({
    ...run,
    fontSize: run.fontSize ?? options.fontSize,
  }));
  const spacing = options.letterSpacing || 0;
  const lines: RichTextLine[] = [
    { segments: [], y: 0, width: 0, height: 0, endsParagraph: false },
  ];
  let lineWidth = 0;

  const advanceLine = (endsParagraph = false) => {
    lines[lines.length - 1].endsParagraph = endsParagraph;
    lines.push({ segments: [], y: 0, width: 0, height: 0, endsParagraph: false });
    lineWidth = 0;
  };

  for (const run of resolvedRuns) {
    if (!run.text) continue;
    const paragraphs = run.text.split('\n');
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const words = paragraphs[pi].split(' ');
      for (let wi = 0; wi < words.length; wi++) {
        const raw = words[wi];
        const line = lines[lines.length - 1];
        if (raw === '') {
          const spaceWidth = measureRichRunWidth(' ', run, spacing, measure);
          if (lineWidth > 0 && lineWidth + spaceWidth > options.width) advanceLine();
          lineWidth += spaceWidth;
          continue;
        }
        const text = wi < words.length - 1 ? `${raw} ` : raw;
        const width = measureRichRunWidth(text, run, spacing, measure);
        if (lineWidth > 0 && lineWidth + width > options.width) advanceLine();
        lines[lines.length - 1].segments.push({
          text,
          x: 0,
          y: 0,
          width,
          run,
          lineIndex: lines.length - 1,
          endsParagraph: false,
        });
        lineWidth += width;
      }
      if (pi < paragraphs.length - 1) advanceLine(true);
    }
  }
  lines[lines.length - 1].endsParagraph = true;

  const lineHeightFactor = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const emptyLineHeight =
    lineHeightFactor * (resolvedRuns[0]?.fontSize ?? options.fontSize);
  let y = 0;
  const segments: RichTextSegment[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    line.y = y;
    line.height = line.segments.length
      ? Math.max(...line.segments.map((seg) => lineHeightFactor * seg.run.fontSize))
      : emptyLineHeight;
    line.width = line.segments.reduce((sum, seg) => sum + seg.width, 0);

    let x = 0;
    let gap = 0;
    if (options.align === 'center') x = (options.width - line.width) / 2;
    else if (options.align === 'right') x = options.width - line.width;
    else if (
      options.align === 'justify' &&
      !line.endsParagraph &&
      line.segments.length > 1 &&
      line.width < options.width
    ) {
      gap = (options.width - line.width) / (line.segments.length - 1);
    }

    for (const segment of line.segments) {
      segment.x = x;
      segment.y = y;
      segment.lineIndex = lineIndex;
      segment.endsParagraph = line.endsParagraph;
      segments.push(segment);
      x += segment.width + gap;
    }
    y += line.height;
  }

  return {
    runs: resolvedRuns,
    lines,
    segments,
    fontSize: options.fontSize,
    height: y,
  };
};

export const fitRichTextToBox = (
  box: FitTextBox,
  runs: TextRun[],
  measure: MeasureRichRun
): FittedRichText => {
  const requestedFloor = Math.max(1, Math.floor(box.minFontSize ?? MIN_FIT_FONT_SIZE));
  const floor = Math.min(box.fontSize, requestedFloor);
  let size = box.fontSize;

  const layoutAt = (fontSize: number): RichTextLayout => {
    const ratio = fontSize / box.fontSize;
    const scaledRuns = runs.map((run) => {
      const authored = run.fontSize ?? box.fontSize;
      return {
        ...run,
        fontSize: Math.min(
          authored,
          Math.max(Math.min(authored, floor), Math.floor(authored * ratio))
        ),
      };
    });
    return layoutRichText(
      scaledRuns,
      {
        width: box.width,
        fontSize,
        lineHeight: box.lineHeight,
        letterSpacing: box.letterSpacing,
        align: box.align,
      },
      measure
    );
  };

  const fits = (layout: RichTextLayout): boolean =>
    layout.height <= box.height &&
    layout.lines.every((line) => line.width <= box.width);

  let layout = layoutAt(size);
  while (box.autoFit === true && size > floor && !fits(layout)) {
    size = Math.max(floor, Math.floor(size * FIT_STEP_RATIO));
    layout = layoutAt(size);
  }
  return { ...layout, fits: fits(layout) };
};

export interface JustifiedWord {
  /** The word itself, without surrounding spaces. */
  text: string;
  /** X offset from the line's left edge. */
  x: number;
}

/**
 * Lay one wrapped line out justified: the slack between the line's natural
 * width and `targetWidth` is distributed evenly into the gaps BETWEEN words.
 * Both renderers paint justified lines word-by-word from these offsets — Konva
 * has no justify of its own and node-canvas no `textAlign: 'justify'`, so this
 * one layout is what keeps the canvas and the export in agreement.
 *
 * Returns null when the line can't or shouldn't be stretched (fewer than two
 * words, or no slack) — the caller then paints it left-aligned, which is also
 * what a paragraph's last line does.
 */
export const justifyLineWords = (
  line: string,
  targetWidth: number,
  fontSize: number,
  letterSpacing: number,
  measure: MeasureText,
  scaleX = 1
): JustifiedWord[] | null => {
  const words = line.split(' ').filter((w) => w.length > 0);
  if (words.length < 2) return null;
  const slack =
    targetWidth - measureLineWidth(line, fontSize, letterSpacing, measure, scaleX);
  if (slack <= 0) return null;
  const gap = slack / (words.length - 1);
  const spaceWidth = measureLineWidth(' ', fontSize, letterSpacing, measure, scaleX);
  const out: JustifiedWord[] = [];
  let x = 0;
  for (const word of words) {
    out.push({ text: word, x });
    x +=
      measureLineWidth(word, fontSize, letterSpacing, measure, scaleX) +
      spaceWidth +
      gap;
  }
  return out;
};
