import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import type { DesignerElement } from './designer-doc.schema';

// Scale (natW × natH) down to fit inside (maxW × maxH) using a single uniform
// factor, so the image's real aspect ratio (and orientation) is preserved.
export const fitWithin = (
  natW: number,
  natH: number,
  maxW: number,
  maxH: number
) => {
  const scale = Math.min(maxW / natW, maxH / natH, 1);
  return { width: Math.round(natW * scale), height: Math.round(natH * scale) };
};

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export const deriveAnchor = (
  el: DesignerElement,
  source: { width: number; height: number }
): Anchor => {
  if (el.anchor) return el.anchor;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const h =
    cx < source.width * 0.33 ? 'left' : cx > source.width * 0.67 ? 'right' : 'center';
  const v =
    cy < source.height * 0.33 ? 'top' : cy > source.height * 0.67 ? 'bottom' : 'center';
  if (h === 'left' && v === 'top') return 'top-left';
  if (h === 'center' && v === 'top') return 'top-center';
  if (h === 'right' && v === 'top') return 'top-right';
  if (h === 'left' && v === 'center') return 'center-left';
  if (h === 'right' && v === 'center') return 'center-right';
  if (h === 'left' && v === 'bottom') return 'bottom-left';
  if (h === 'center' && v === 'bottom') return 'bottom-center';
  if (h === 'right' && v === 'bottom') return 'bottom-right';
  return 'center';
};

const anchorX = (anchor: Anchor, targetW: number, w: number): number => {
  if (anchor.includes('left')) return 0;
  if (anchor.includes('right')) return targetW - w;
  return (targetW - w) / 2;
};

const anchorY = (anchor: Anchor, targetH: number, h: number): number => {
  if (anchor.includes('top')) return 0;
  if (anchor.includes('bottom')) return targetH - h;
  return (targetH - h) / 2;
};

export const smartReflow = (
  el: DesignerElement,
  source: { width: number; height: number },
  target: { width: number; height: number; formatId?: string }
): Partial<DesignerElement> => {
  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const scale = Math.min(scaleX, scaleY);

  const anchor = deriveAnchor(el, source);
  let newW: number;
  let newH: number;
  const result: Partial<DesignerElement> = { anchor };

  if (el.type === 'image') {
    const mode = el.fitMode || 'cover';
    if (mode === 'cover' || mode === 'contain') {
      const { width: w, height: h } = fitWithin(
        el.naturalWidth || el.width || source.width,
        el.naturalHeight || el.height || source.height,
        target.width,
        target.height
      );
      newW = mode === 'cover' ? target.width : w;
      newH = mode === 'cover' ? target.height : h;
      result.width = newW;
      result.height = newH;
      result.fitMode = mode;
      result.focalPoint = el.focalPoint || { x: 0.5, y: 0.5 };
    } else {
      newW = Math.max(10, Math.round(el.width * scaleX));
      newH = Math.max(10, Math.round(el.height * scaleY));
      result.width = newW;
      result.height = newH;
    }
  } else {
    newW = Math.max(10, Math.round(el.width * scale));
    newH = Math.max(10, Math.round(el.height * scale));
    result.width = newW;
    result.height = newH;

    if (el.fontSize) {
      const newFontSize = Math.round(el.fontSize * scale);
      result.fontSize = Math.max(10, newFontSize);
    }
  }

  let x = anchorX(anchor, target.width, newW);
  let y = anchorY(anchor, target.height, newH);

  // Keep text, images, and shapes inside the title-safe area so they remain
  // readable / uncropped by platform overlays. For images and shapes we only
  // nudge when the element actually overlaps a safe-zone edge, preserving the
  // user's intentional edge-to-edge placements when possible.
  if (el.type === 'text' || el.type === 'image' || el.type === 'shape') {
    const safe = getSafeZoneInset(target.formatId || '', target.width, target.height);
    if (el.type === 'text') {
      if (x < safe.left) x = safe.left;
      if (x + newW > safe.right) x = Math.max(safe.left, safe.right - newW);
      if (y < safe.top) y = safe.top;
      if (y + newH > safe.bottom) y = Math.max(safe.top, safe.bottom - newH);
    } else {
      const safeW = safe.right - safe.left;
      const safeH = safe.bottom - safe.top;
      if (newW <= safeW) {
        if (x < safe.left) x = safe.left;
        if (x + newW > safe.right) x = Math.max(safe.left, safe.right - newW);
      }
      if (newH <= safeH) {
        if (y < safe.top) y = safe.top;
        if (y + newH > safe.bottom) y = Math.max(safe.top, safe.bottom - newH);
      }
    }
  }

  result.x = x;
  result.y = y;
  return result;
};

export const estimateFocalPoint = (
  naturalWidth: number,
  naturalHeight: number
): { x: number; y: number } => {
  const ratio = naturalWidth / naturalHeight;
  if (ratio < 1) {
    return { x: 0.5, y: 0.35 };
  }
  return { x: 0.5, y: 0.5 };
};

export const getSafeZoneInset = (
  formatId: string,
  width: number,
  height: number
) => {
  const fallback = {
    left: width * 0.05,
    top: height * 0.05,
    right: width * 0.95,
    bottom: height * 0.95,
  };
  const preset = CHANNEL_PRESETS.find((p) => p.id === formatId);
  if (!preset?.safeZones?.length) {
    return fallback;
  }
  // `safeZones` are UNSAFE overlay rects (platform UI chrome — see
  // channel-presets.ts). Each zone hugging a canvas edge shrinks the safe
  // area from that edge; zones floating in the interior can't be expressed
  // as an inset box and are ignored.
  let left = 0;
  let top = 0;
  let right = width;
  let bottom = height;
  for (const z of preset.safeZones) {
    const spansWidth = z.x <= 0 && z.x + z.width >= width;
    const spansHeight = z.y <= 0 && z.y + z.height >= height;
    if (spansWidth && z.y <= 0) top = Math.max(top, z.y + z.height);
    if (spansWidth && z.y + z.height >= height) {
      bottom = Math.min(bottom, z.y);
    }
    if (spansHeight && z.x <= 0) left = Math.max(left, z.x + z.width);
    if (spansHeight && z.x + z.width >= width) right = Math.min(right, z.x);
  }
  // Degenerate zone data (overlays covering the canvas) — fall back rather
  // than clamp everything into a zero-area box.
  if (left >= right || top >= bottom) {
    return fallback;
  }
  return { left, top, right, bottom };
};
