import {
  applyTextTransform,
  fitTextToBox,
  measureLineWidth,
  wrapTextLines,
  type FittedText,
  type MeasureText,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import type { DesignerElement } from './designer.store';

/**
 * Client half of the shared text fitter. The algorithm lives in
 * `designer-doc/fit-text` and is shared with the server renderer so the canvas
 * and the exported image agree; this module only supplies the browser
 * measurement primitive.
 */

// One offscreen context for the lifetime of the tab — creating a canvas per
// measurement is what makes naive text-fitting slow.
let measureCtx: CanvasRenderingContext2D | null | undefined;

const getMeasureCtx = (): CanvasRenderingContext2D | null => {
  if (measureCtx !== undefined) return measureCtx;
  try {
    measureCtx = document.createElement('canvas').getContext('2d');
  } catch {
    // jsdom without a canvas backend, or a locked-down environment.
    measureCtx = null;
  }
  return measureCtx;
};

/**
 * Font shorthand in the SAME shape the server renderer uses
 * (`design-render.service.ts`), so both sides measure identically. Note this
 * differs from the combined `fontStyle` string Konva itself takes.
 */
const fontShorthand = (el: DesignerElement, fontSize: number): string => {
  const style = el.fontStyle === 'italic' ? 'italic' : 'normal';
  const weight = el.fontWeight || 400;
  const family = el.fontFamily || 'sans-serif';
  return `${style} ${weight} ${fontSize}px ${family}`;
};

/**
 * Shrink-to-fit a flat text element against its box. Returns `null` when the
 * element isn't flat text (rich/curved text lay out differently) or when no
 * canvas is available to measure with — callers then fall back to the authored
 * `fontSize`.
 */
export const fitDesignerText = (el: DesignerElement): FittedText | null => {
  if (el.type !== 'text') return null;
  if (el.richText?.length || el.textPath || (el.curve || 0) !== 0) return null;
  const text = el.text ?? '';
  if (!text.trim() || !(el.width > 0) || !(el.height > 0)) return null;

  const ctx = getMeasureCtx();
  if (!ctx) return null;

  return fitTextToBox(
    {
      text,
      width: el.width,
      height: el.height,
      fontSize: el.fontSize || 16,
      lineHeight: el.lineHeight,
      letterSpacing: el.letterSpacing,
      scaleX: el.textScaleX,
      textTransform: el.textTransform,
      paragraphSpacing: el.paragraphSpacing,
      firstLineIndent: el.firstLineIndent,
    },
    (line, size) => {
      ctx.font = fontShorthand(el, size);
      return ctx.measureText(line).width;
    }
  );
};

/**
 * The browser measurement primitive for one element, for callers that drive
 * `fitTextToBox` themselves — the SVG exporter, which has to lay lines out
 * because SVG has neither word wrap nor shrink-to-fit.
 */
export const measureForElement = (el: DesignerElement): MeasureText | undefined => {
  const ctx = getMeasureCtx();
  if (!ctx) return undefined;
  return (line, size) => {
    ctx.font = fontShorthand(el, size);
    return ctx.measureText(line).width;
  };
};

/**
 * Grow a flat text box enough for its authored size. Width changes only when
 * one unwrapped word cannot fit; ordinary wrapping affects height alone.
 */
const boxPatchFor = (
  element: DesignerElement | null,
  fontSize: number,
  measure?: MeasureText | null,
  bounds?: { width: number; height: number },
  shrinkHeight = false
): Partial<DesignerElement> => {
  if (!element || element.type !== 'text') return {};
  if (element.richText?.length || element.textPath || (element.curve || 0) !== 0) {
    return {};
  }
  const m = measure === undefined ? measureForElement(element) : measure;
  if (!m) return {};

  const text = applyTextTransform(element.text ?? '', element.textTransform);
  const indent = element.firstLineIndent || 0;
  const letterSpacing = element.letterSpacing || 0;
  const scaleX = element.textScaleX || 1;
  const lines = wrapTextLines(
    text,
    Math.max(1, element.width - indent),
    fontSize,
    letterSpacing,
    m,
    scaleX
  );
  const paragraphs = text.split('\n').length;
  const needed =
    Math.ceil(Math.max(1, lines.length) * (element.lineHeight || 1.2) * fontSize) +
    Math.max(0, paragraphs - 1) * (element.paragraphSpacing || 0);

  const patch: Partial<DesignerElement> = {};
  if (needed > element.height) {
    const nextHeight = bounds
      ? Math.min(needed, Math.max(element.height, bounds.height))
      : needed;
    if (nextHeight > element.height) {
      patch.height = nextHeight;
      const delta = nextHeight - element.height;
      if (element.verticalAlign === 'middle' || element.verticalAlign === 'bottom') {
        const desiredY = element.y - delta / (element.verticalAlign === 'middle' ? 2 : 1);
        patch.y = bounds
          ? Math.max(0, Math.min(Math.max(0, bounds.height - nextHeight), desiredY))
          : desiredY;
      }
    }
  } else if (shrinkHeight && needed < element.height) {
    patch.height = needed;
  }
  if (lines.length === 1 && paragraphs === 1) {
    const lineWidth =
      measureLineWidth(lines[0], fontSize, letterSpacing, m, scaleX) + indent;
    if (lineWidth > element.width) {
      const nextWidth = bounds
        ? Math.min(Math.ceil(lineWidth), Math.max(element.width, bounds.width))
        : Math.ceil(lineWidth);
      if (nextWidth > element.width) {
        patch.width = nextWidth;
        const delta = nextWidth - element.width;
        if (element.align === 'center' || element.align === 'right') {
          const desiredX = element.x - delta / (element.align === 'center' ? 2 : 1);
          patch.x = bounds
            ? Math.max(0, Math.min(Math.max(0, bounds.width - nextWidth), desiredX))
            : desiredX;
        }
      }
    }
  }
  return patch;
};

export const growBoxFor = (
  element: DesignerElement | null,
  fontSize: number,
  measure?: MeasureText | null,
  bounds?: { width: number; height: number }
): Partial<DesignerElement> => boxPatchFor(element, fontSize, measure, bounds);

export const fitStyleBoxFor = (
  element: DesignerElement | null,
  fontSize: number,
  measure?: MeasureText | null,
  shrinkHeight = false
): Partial<DesignerElement> => boxPatchFor(element, fontSize, measure, undefined, shrinkHeight);

/**
 * The size flat text should actually be painted at — the fitted size when it
 * had to shrink, otherwise the authored one.
 */
export const fittedFontSize = (el: DesignerElement): number =>
  fitDesignerText(el)?.fontSize ?? el.fontSize ?? 16;

/** Slack either side of the measured glyphs so a new box never wraps on itself. */
const NEW_TEXT_PADDING_PX = 8;

/** Fallback average glyph width as a fraction of the em, used when unmeasurable. */
const FALLBACK_GLYPH_EM = 0.6;

export interface NewTextSpec {
  text: string;
  fontSize: number;
  fontWeight?: number;
  fontFamily?: string;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  letterSpacing?: number;
  /** Horizontal scale, so a condensed box is born the width it will paint. */
  textScaleX?: number;
}

/**
 * A starting box that actually contains one line of the given text at its
 * authored size.
 *
 * Every text-creation site used to hardcode 200×40 regardless of font, so a
 * 48px heading was born overflowing its own selection box — and the exporter
 * then shrank it to ~29px to fit. Sizing the box from the font keeps the
 * selection box honest and the canvas and export in agreement from the start.
 */
export const defaultTextBox = (
  spec: NewTextSpec
): { width: number; height: number } => {
  const fontSize = spec.fontSize || 16;
  const lineHeight = spec.lineHeight || 1.2;
  const letterSpacing = spec.letterSpacing || 0;
  const height = Math.ceil(fontSize * lineHeight);

  const ctx = getMeasureCtx();
  let textWidth: number;
  if (ctx) {
    ctx.font = fontShorthand(
      {
        fontStyle: spec.fontStyle,
        fontWeight: spec.fontWeight,
        fontFamily: spec.fontFamily,
      } as DesignerElement,
      fontSize
    );
    textWidth = ctx.measureText(spec.text).width;
  } else {
    textWidth = spec.text.length * fontSize * FALLBACK_GLYPH_EM;
  }
  textWidth += letterSpacing * spec.text.length;
  textWidth *= spec.textScaleX || 1;

  return {
    width: Math.max(1, Math.ceil(textWidth + NEW_TEXT_PADDING_PX * 2)),
    height,
  };
};
