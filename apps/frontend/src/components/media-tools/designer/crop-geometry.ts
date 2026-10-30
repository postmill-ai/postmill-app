import type { DesignerElement } from './designer.store';
import type { DesignerCrop } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { computeCoverCrop, computeMediaDraw } from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';

/**
 * Crop maths for the on-canvas Crop tool.
 *
 * `DesignerCrop` is a rect in SOURCE-image pixel space, while the crop overlay
 * works in the element's displayed box. Cropping an already-cropped element has
 * to compose the two, which is the part that's easy to get wrong — so it lives
 * here as a pure function with tests rather than inline in the overlay.
 */

/** A sub-rect of the element's current box, as 0–1 fractions of it. */
export interface BoxFraction {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropResult {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: DesignerCrop;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Normalise a fraction rect so it stays inside the box and has positive size. */
export const normaliseFraction = (f: BoxFraction): BoxFraction => {
  const x = clamp01(Math.min(f.x, f.x + f.width));
  const y = clamp01(Math.min(f.y, f.y + f.height));
  const width = clamp01(Math.abs(f.width) + Math.min(0, f.x) * 0);
  const height = clamp01(Math.abs(f.height));
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
};

type CropElement = Pick<
  DesignerElement,
  'x' | 'y' | 'width' | 'height' | 'crop' | 'fitMode' | 'focalPoint'
>;

export type CropResizeHandle =
  | 'top-left' | 'top' | 'top-right'
  | 'right' | 'bottom-right' | 'bottom'
  | 'bottom-left' | 'left';

/** The effective source window, including an automatic cover crop. */
export const currentSourceWindow = (
  el: Pick<DesignerElement, 'width' | 'height' | 'crop' | 'fitMode' | 'focalPoint'>,
  natural: { width: number; height: number }
): DesignerCrop => {
  if (el.crop) return el.crop;
  if (el.fitMode === 'cover') {
    return computeCoverCrop(
      natural.width,
      natural.height,
      el.width,
      el.height,
      el.focalPoint
    );
  }
  return { x: 0, y: 0, width: natural.width, height: natural.height };
};

const FULL_BOX: BoxFraction = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Fit a source crop into the selected destination box without changing its
 * aspect. The manipulated handle stays on the selected edge; the opposite
 * edge is the stationary resize anchor.
 */
export const cropFromSourceRect = (
  el: Pick<DesignerElement, 'x' | 'y' | 'width' | 'height'>,
  crop: DesignerCrop,
  fraction: BoxFraction = FULL_BOX,
  handle?: CropResizeHandle
): CropResult => {
  const f = normaliseFraction(fraction);
  const raw = {
    x: el.x + f.x * el.width,
    y: el.y + f.y * el.height,
    width: Math.max(1, f.width * el.width),
    height: Math.max(1, f.height * el.height),
  };
  const source = {
    x: crop.x,
    y: crop.y,
    width: Math.max(1, crop.width),
    height: Math.max(1, crop.height),
  };
  const scale = Math.min(raw.width / source.width, raw.height / source.height);
  const width = Math.max(1, source.width * scale);
  const height = Math.max(1, source.height * scale);
  const alignX = handle?.includes('left') ? 1 : handle?.includes('right') ? 0 : handle ? 0.5 : 0;
  const alignY = handle?.includes('top') ? 1 : handle?.includes('bottom') ? 0 : handle ? 0.5 : 0;

  return {
    x: raw.x + (raw.width - width) * alignX,
    y: raw.y + (raw.height - height) * alignY,
    width,
    height,
    crop: source,
  };
};

/** The on-canvas box that actually paints pixels, excluding contain letterboxing. */
export const cropDisplayBox = (
  el: CropElement,
  natural: { width: number; height: number } | null
): Pick<DesignerElement, 'x' | 'y' | 'width' | 'height'> => {
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) return el;
  const { destination } = computeMediaDraw({
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    targetWidth: el.width,
    targetHeight: el.height,
    crop: el.crop,
    fitMode: el.fitMode,
    focalPoint: el.focalPoint,
  });
  return {
    x: el.x + destination.x,
    y: el.y + destination.y,
    width: destination.width,
    height: destination.height,
  };
};

/**
 * Apply a crop expressed as a fraction of the element's displayed box.
 * Cropping an already-cropped or cover-fitted element composes onto the source
 * window it actually paints, not the full bitmap.
 */
export const cropFromBoxFraction = (
  el: CropElement,
  natural: { width: number; height: number } | null,
  fraction: BoxFraction,
  handle?: CropResizeHandle
): CropResult => {
  const f = normaliseFraction(fraction);
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
    return {
      x: el.x + f.x * el.width,
      y: el.y + f.y * el.height,
      width: Math.max(1, f.width * el.width),
      height: Math.max(1, f.height * el.height),
    };
  }

  const current = currentSourceWindow(el, natural);
  return cropFromSourceRect(
    cropDisplayBox(el, natural),
    {
      x: current.x + f.x * current.width,
      y: current.y + f.y * current.height,
      width: Math.max(1, f.width * current.width),
      height: Math.max(1, f.height * current.height),
    },
    f,
    handle
  );
};

/** Aspect ratio from an options-bar value like `"16:9"`, or null for free. */
export const parseCropRatio = (value: string | undefined): number | null => {
  if (!value || value === 'free') return null;
  const [w, h] = value.split(':').map(Number);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
};

/**
 * Constrain a fraction rect to an aspect ratio, given the box's own aspect so
 * the ratio holds in CANVAS space rather than fraction space. Shrinks the
 * longer axis so the result always stays within the box.
 */
export const constrainFractionToRatio = (
  f: BoxFraction,
  ratio: number | null,
  boxWidth: number,
  boxHeight: number
): BoxFraction => {
  if (!ratio || !(boxWidth > 0) || !(boxHeight > 0)) return f;
  const pxW = f.width * boxWidth;
  const pxH = f.height * boxHeight;
  if (!(pxW > 0) || !(pxH > 0)) return f;

  // Keep whichever axis implies the smaller rect, so we never grow past the box.
  const wFromH = pxH * ratio;
  const [newW, newH] = wFromH <= pxW ? [wFromH, pxH] : [pxW, pxW / ratio];

  return normaliseFraction({
    x: f.x,
    y: f.y,
    width: newW / boxWidth,
    height: newH / boxHeight,
  });
};
