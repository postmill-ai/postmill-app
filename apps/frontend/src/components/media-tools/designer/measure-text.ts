import {
  fitTextToBox,
  type FittedText,
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
    },
    (line, size) => {
      ctx.font = fontShorthand(el, size);
      return ctx.measureText(line).width;
    }
  );
};

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

  return {
    width: Math.max(1, Math.ceil(textWidth + NEW_TEXT_PADDING_PX * 2)),
    height,
  };
};
