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
