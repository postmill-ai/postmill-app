import { MAX_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { MIN_FIT_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import type { DesignerElement } from './designer.store';

/**
 * Turning a live Konva transform into a store patch.
 *
 * Kept free of Konva types so it can be unit-tested with plain objects — the
 * caller reads the numbers off the node and passes them in.
 */

/** Smallest box the transformer may produce, in canvas px. */
export const MIN_ELEMENT_SIZE = 10;

/** Which dimensions an anchor is allowed to change. */
export type ResizeAxis = 'both' | 'x' | 'y';

const X_ONLY_ANCHORS = new Set(['middle-left', 'middle-right']);
const Y_ONLY_ANCHORS = new Set(['top-center', 'bottom-center']);

/**
 * Corner anchors scale both axes (and, for text, the type with them). Side
 * anchors change a single dimension: dragging the side of a text box re-wraps
 * it at the same font size, which is what makes the box a wrapping frame
 * rather than a zoom control.
 */
export const axisForAnchor = (anchor: string | null | undefined): ResizeAxis => {
  if (anchor && X_ONLY_ANCHORS.has(anchor)) return 'x';
  if (anchor && Y_ONLY_ANCHORS.has(anchor)) return 'y';
  return 'both';
};

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/**
 * True when the canvas draws the element as a node whose `width()`/`height()`
 * report the bbox of its drawn POINTS rather than the element box: anything
 * warped (resampled to a Konva `Line` polyline) and the polygonal shapes
 * (star/triangle/polygon/line), which are `Konva.Line`s with explicit points.
 *
 * That bbox is not the box — a star's points span ≈0.951 of the box width and
 * ≈0.905 of the height — so baking `node.width() * scaleX` per transform frame
 * shrank the stored box asymmetrically, React re-derived the points from the
 * shrunken box, and the distortion compounded. Even a pure rotation suffered:
 * scale stays 1 but bbox ≠ box. For these elements the document's own
 * `width`/`height` is the only honest base.
 */
export const usesPointsBoundingBox = (
  el: Pick<DesignerElement, 'type' | 'shape' | 'warp'>
): boolean => {
  if (el.warp?.preset && !!(el.warp.bend || el.warp.distortH || el.warp.distortV)) {
    return true;
  }
  return (
    el.type === 'shape' &&
    (el.shape === 'star' ||
      el.shape === 'triangle' ||
      el.shape === 'polygon' ||
      el.shape === 'line')
  );
};

export interface ResizePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize?: number;
}

/**
 * Uniform scale factor for a corner drag. Konva's `keepRatio` defaults to true,
 * so a corner drag normally gives scaleX === scaleY and this is just that
 * value; the geometric mean keeps the result sane and axis-symmetric if ratio
 * keeping is ever turned off or overridden with shift.
 */
const uniformScale = (scaleX: number, scaleY: number): number =>
  Math.sqrt(Math.abs(scaleX) * Math.abs(scaleY));

/**
 * Bake a node's live scale into absolute width/height — the document model has
 * no scaleX/scaleY, so every transform must be converted, never stored as
 * scale.
 *
 * For flat text dragged by a CORNER the font scales with the box, matching what
 * `smartReflow` already does when an element moves between output formats
 * (`designer-doc/reflow.ts`). Rich and curved text are left alone: they lay out
 * through different code paths where a single fontSize isn't authoritative.
 */
export const buildResizePatch = (
  el: Pick<DesignerElement, 'type' | 'fontSize' | 'richText' | 'textPath' | 'curve'>,
  node: NodeGeometry,
  anchor: string | null | undefined
): ResizePatch => {
  const patch: ResizePatch = {
    x: node.x,
    y: node.y,
    width: Math.max(node.width * node.scaleX, MIN_ELEMENT_SIZE),
    height: Math.max(node.height * node.scaleY, MIN_ELEMENT_SIZE),
    rotation: node.rotation,
  };

  const isFlatText =
    el.type === 'text' &&
    !el.richText?.length &&
    !el.textPath &&
    (el.curve || 0) === 0;

  if (isFlatText && el.fontSize && axisForAnchor(anchor) === 'both') {
    const factor = uniformScale(node.scaleX, node.scaleY);
    if (factor > 0 && factor !== 1) {
      patch.fontSize = Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FIT_FONT_SIZE, Math.round(el.fontSize * factor))
      );
    }
  }

  return patch;
};

export interface BakedTransform {
  patch: ResizePatch;
  /**
   * False for points-bbox elements: writing width/height onto a Konva `Line`
   * does not rescale its points — the points are re-derived from the patched
   * element on the next render, so the node must be left alone.
   */
  writeBackSize: boolean;
}

/**
 * One node's transform, baked. Picks the honest base geometry per element
 * (see `usesPointsBoundingBox`) and then delegates to `buildResizePatch`, so
 * the canvas only reads raw numbers off the Konva node.
 */
export const bakeElementTransform = (
  el: Pick<
    DesignerElement,
    | 'type'
    | 'shape'
    | 'warp'
    | 'width'
    | 'height'
    | 'fontSize'
    | 'richText'
    | 'textPath'
    | 'curve'
  >,
  node: NodeGeometry,
  anchor: string | null | undefined
): BakedTransform => {
  const pointsBBox = usesPointsBoundingBox(el);
  const patch = buildResizePatch(
    el,
    {
      ...node,
      width: pointsBBox ? el.width : node.width,
      height: pointsBBox ? el.height : node.height,
    },
    anchor
  );
  return { patch, writeBackSize: !pointsBBox };
};
