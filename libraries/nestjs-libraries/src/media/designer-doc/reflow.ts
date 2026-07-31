import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
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

export interface GroupBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Combined bounding boxes of every `groupId` present in `elements` — the
 * shared anchor frame a CTA/badge pair is reflowed through so the pair keeps
 * its relative offsets instead of each element anchoring independently.
 */
export const computeGroupBoxes = (
  elements: DesignerElement[]
): Map<string, GroupBox> => {
  const boxes = new Map<string, GroupBox>();
  for (const el of elements) {
    if (!el.groupId) continue;
    const box = boxes.get(el.groupId);
    if (!box) {
      boxes.set(el.groupId, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      });
      continue;
    }
    const right = Math.max(box.x + box.width, el.x + el.width);
    const bottom = Math.max(box.y + box.height, el.y + el.height);
    box.x = Math.min(box.x, el.x);
    box.y = Math.min(box.y, el.y);
    box.width = right - box.x;
    box.height = bottom - box.y;
  }
  return boxes;
};

/**
 * Role-aware minimum legible font size on a canvas: a badge/CTA group label
 * (anything carrying a reflow `groupId`) floors at 12px scaled with the
 * canvas's short side (1080 basis); other text keeps the flat 10px floor.
 * Shared with the composer's text-fit clamps so repeated clamp passes can
 * never ratchet a label below legibility.
 */
export const roleFontFloorPx = (
  el: Pick<DesignerElement, 'groupId'>,
  canvasW: number,
  canvasH: number
): number =>
  el.groupId
    ? Math.max(10, Math.round((12 * Math.min(canvasW, canvasH)) / 1080))
    : 10;

/**
 * Synthetic shared anchor frames for ungrouped copy stacks: visible texts in
 * the same column — x-ranges overlapping ≥60% of the narrower box — within a
 * normal stack rhythm (vertical gap ≤8% of the source height) reflow through
 * one combined frame, exactly like `computeGroupBoxes` members. Without
 * this, `deriveAnchor`'s thirds-bucketing can split a stack whose members
 * straddle a 0.33 boundary onto different anchors, tearing a subhead
 * hundreds of px away from its headline on aspect change.
 */
export const computeTextStackBoxes = (
  elements: DesignerElement[],
  source: { width: number; height: number }
): Map<DesignerElement, GroupBox> => {
  const texts = [...elements]
    .filter((el) => el.type === 'text' && !el.groupId && !el.hidden)
    .sort((a, b) => a.y - b.y);
  const result = new Map<DesignerElement, GroupBox>();
  const maxGap = source.height * 0.08;
  const sameColumn = (a: DesignerElement, b: DesignerElement): boolean => {
    const overlap =
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    return overlap >= 0.6 * Math.min(a.width, b.width);
  };
  let stack: DesignerElement[] = [];
  const flush = () => {
    if (stack.length >= 2) {
      const right = Math.max(...stack.map((m) => m.x + m.width));
      const bottom = Math.max(...stack.map((m) => m.y + m.height));
      const x = Math.min(...stack.map((m) => m.x));
      const y = Math.min(...stack.map((m) => m.y));
      const box: GroupBox = { x, y, width: right - x, height: bottom - y };
      for (const member of stack) result.set(member, box);
    }
    stack = [];
  };
  for (const el of texts) {
    const prev = stack[stack.length - 1];
    if (!prev || (sameColumn(prev, el) && el.y - (prev.y + prev.height) <= maxGap)) {
      stack.push(el);
      continue;
    }
    flush();
    stack.push(el);
  }
  flush();
  return result;
};

export const smartReflow = (
  el: DesignerElement,
  source: { width: number; height: number },
  target: { width: number; height: number; formatId?: string },
  groupBox?: GroupBox
): Partial<DesignerElement> => {
  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const scale = Math.min(scaleX, scaleY);

  // A grouped element (CTA label + pill/underline, badge + label) anchors as
  // ONE unit: the anchor is re-derived from the group's combined bbox (a
  // member's own stored anchor would re-split the pair) so every member is
  // placed by the same transform and their relative offsets survive.
  const anchor = groupBox
    ? deriveAnchor({ ...el, ...groupBox, anchor: undefined }, source)
    : deriveAnchor(el, source);
  let newW: number;
  let newH: number;
  const result: Partial<DesignerElement> = { anchor };

  // A shape that spans (≈) the full source canvas on an axis — split-panel
  // and editorial-sidebar background panels — must scale per-axis and keep
  // its fractional position like a cover image; the uniform scale below
  // would shrink a full-height panel into a floating rect on aspect change.
  const fullBleedShape =
    el.type === 'shape' &&
    (el.width >= source.width * 0.95 || el.height >= source.height * 0.95);

  if (el.type === 'image') {
    const mode = el.fitMode || 'cover';
    if (mode === 'cover') {
      // Cover images keep their template-assigned box, scaled per-axis to the
      // target canvas (the render-time cover-crop handles aspect). Sizing to
      // the full target here turned partial-area covers — e.g. a split-panel
      // image column — into full-canvas backgrounds on seeded outputs,
      // burying the panel and copy under the image.
      newW = Math.max(10, Math.round(el.width * scaleX));
      newH = Math.max(10, Math.round(el.height * scaleY));
      result.width = newW;
      result.height = newH;
      result.fitMode = mode;
      result.focalPoint = el.focalPoint || { x: 0.5, y: 0.5 };
    } else if (mode === 'contain') {
      const { width: w, height: h } = fitWithin(
        el.naturalWidth || el.width || source.width,
        el.naturalHeight || el.height || source.height,
        target.width,
        target.height
      );
      newW = w;
      newH = h;
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
  } else if (fullBleedShape) {
    newW = Math.max(10, Math.round(el.width * scaleX));
    newH = Math.max(10, Math.round(el.height * scaleY));
    result.width = newW;
    result.height = newH;
  } else {
    newW = Math.max(10, Math.round(el.width * scale));
    newH = Math.max(10, Math.round(el.height * scale));
    result.width = newW;
    result.height = newH;

    if (el.fontSize) {
      const newFontSize = Math.round(el.fontSize * scale);
      // Role-aware floor: a badge/CTA group label must stay legible — 12px
      // at a 1080 canvas (scaled with the output), vs the flat 10px floor
      // for ungrouped text.
      const floor = roleFontFloorPx(el, target.width, target.height);
      result.fontSize = Math.max(floor, newFontSize);
    }
  }

  // Cover images and full-bleed shapes keep their fractional position
  // (per-axis scale); a grouped element (explicit groupId or a synthetic
  // copy-stack frame) follows its group's anchor transform; everything else
  // snaps to the derived anchor.
  let x: number;
  let y: number;
  if (
    (el.type === 'image' && (el.fitMode || 'cover') === 'cover') ||
    fullBleedShape
  ) {
    x = Math.round(el.x * scaleX);
    y = Math.round(el.y * scaleY);
  } else if (groupBox) {
    const groupW = groupBox.width * scale;
    const groupH = groupBox.height * scale;
    x = Math.round(
      anchorX(anchor, target.width, groupW) + (el.x - groupBox.x) * scale
    );
    y = Math.round(
      anchorY(anchor, target.height, groupH) + (el.y - groupBox.y) * scale
    );
  } else {
    x = anchorX(anchor, target.width, newW);
    y = anchorY(anchor, target.height, newH);
  }

  // Keep text, images, and shapes inside the title-safe area so they remain
  // readable / uncropped by platform overlays. For images and shapes we only
  // nudge when the element actually overlaps a safe-zone edge, preserving the
  // user's intentional edge-to-edge placements when possible.
  if (el.type === 'text' || el.type === 'image' || el.type === 'shape') {
    const safe = getSafeZoneInset(target.formatId || '', target.width, target.height);
    if (el.type === 'text') {
      // A box wider than the title-safe area still overflows the right edge
      // after x-clamping — shrink the width to fit first.
      const safeW = safe.right - safe.left;
      if (newW > safeW) {
        newW = Math.max(10, Math.floor(safeW));
        result.width = newW;
      }
      if (x < safe.left) x = safe.left;
      if (x + newW > safe.right) x = Math.max(safe.left, safe.right - newW);
      if (y < safe.top) y = safe.top;
      if (y + newH > safe.bottom) y = Math.max(safe.top, safe.bottom - newH);
    } else {
      const safeW = safe.right - safe.left;
      const safeH = safe.bottom - safe.top;
      // Full-bleed per-axis elements (cover images, panel bands) and any
      // side already flush with the canvas edge are exempt: pulling a flush
      // edge inward leaves a background-colored "frame" strip behind it.
      // Grouped pairs (CTA/badge) are never flush-exempt — their label
      // clamps identically, so an exempted side would unglue the pair.
      // Neither are badge chips (`*-bg` companions and small accents under
      // 6% of the source canvas): a chip flush with an edge is a clipped
      // badge, not an intentional bleed — bands/panels keep their exemption
      // through the perAxis/fullBleedShape path above.
      const perAxis =
        (el.type === 'image' && (el.fitMode || 'cover') === 'cover') ||
        fullBleedShape;
      const isChip =
        !!el.originId?.endsWith('-bg') ||
        el.width * el.height < source.width * source.height * 0.06;
      const flushLeft = !el.groupId && !isChip && x === 0;
      const flushRight =
        !el.groupId && !isChip && Math.abs(x + newW - target.width) <= 1;
      const flushTop = !el.groupId && !isChip && y === 0;
      const flushBottom =
        !el.groupId && !isChip && Math.abs(y + newH - target.height) <= 1;
      if (newW <= safeW && !perAxis) {
        if (x < safe.left && !flushLeft) x = safe.left;
        if (x + newW > safe.right && !flushRight) {
          x = Math.max(safe.left, safe.right - newW);
        }
      }
      if (newH <= safeH && !perAxis) {
        if (y < safe.top && !flushTop) y = safe.top;
        if (y + newH > safe.bottom && !flushBottom) {
          y = Math.max(safe.top, safe.bottom - newH);
        }
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
