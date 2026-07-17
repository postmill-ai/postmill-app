import type { DesignerElement, DesignerOutput } from './designer-doc.schema';
import { smartReflow, estimateFocalPoint } from './reflow';
import { genId } from './designer-doc.migrate';

/**
 * Clone a source element into a target output, scaling/centering it with
 * `smartReflow` and wiring it to the same `originId` so it participates in
 * linked-by-default updates.
 */
export const seedCopy = (
  el: DesignerElement,
  sourceOutput: { width: number; height: number },
  targetOutput: { width: number; height: number; formatId?: string },
  originId: string
): DesignerElement => {
  const smart = smartReflow(el, sourceOutput, targetOutput);
  const newW = smart.width ?? el.width;
  const newH = smart.height ?? el.height;
  const base: DesignerElement = JSON.parse(JSON.stringify(el));
  const copy: DesignerElement = {
    ...base,
    id: genId(),
    originId,
  };
  Object.assign(copy, smart);
  if (copy.x === undefined) copy.x = (targetOutput.width - newW) / 2;
  if (copy.y === undefined) copy.y = (targetOutput.height - newH) / 2;
  if (
    copy.type === 'image' &&
    copy.fitMode === 'cover' &&
    !copy.focalPoint &&
    copy.naturalWidth &&
    copy.naturalHeight
  ) {
    copy.focalPoint = estimateFocalPoint(copy.naturalWidth, copy.naturalHeight);
  }
  return copy;
};
