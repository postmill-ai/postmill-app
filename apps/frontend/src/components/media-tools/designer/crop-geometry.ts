import type { DesignerElement } from './designer.store';
import type { DesignerCrop } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

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

/**
 * Apply a crop expressed as a fraction of the element's displayed box.
 *
 * Returns the element's new position/size plus the composed source-space crop.
 * When the element has no natural size (not an image, or not loaded yet) the
 * box is still adjusted but no crop is emitted — cropping a shape just resizes
 * it.
 */
export const cropFromBoxFraction = (
  el: Pick<DesignerElement, 'x' | 'y' | 'width' | 'height' | 'crop'>,
  natural: { width: number; height: number } | null,
  fraction: BoxFraction
): CropResult => {
  const f = normaliseFraction(fraction);

  const box = {
    x: el.x + f.x * el.width,
    y: el.y + f.y * el.height,
    width: Math.max(1, f.width * el.width),
    height: Math.max(1, f.height * el.height),
  };

  if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
    return box;
  }

  // The window of source pixels the box shows today.
  const current: DesignerCrop = el.crop || {
    x: 0,
    y: 0,
    width: natural.width,
    height: natural.height,
  };

  return {
    ...box,
    crop: {
      x: current.x + f.x * current.width,
      y: current.y + f.y * current.height,
      width: Math.max(1, f.width * current.width),
      height: Math.max(1, f.height * current.height),
    },
  };
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
