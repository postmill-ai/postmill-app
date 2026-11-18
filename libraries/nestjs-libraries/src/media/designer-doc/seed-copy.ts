import type { DesignerElement, DesignerOutput } from './designer-doc.schema';
import {
  smartReflow,
  estimateFocalPoint,
  computeContainerBoxes,
  computeGroupBoxes,
  computeTextStackBoxes,
  type GroupBox,
  type TypeBasisCanvas,
} from './reflow';
import { genId } from './designer-doc.migrate';

/**
 * Clone a source element into a target output, scaling/centering it with
 * `smartReflow`. A supplied `originId` links it for shared updates; omitting
 * it removes the source link for an independent copy. `groupBox` (the element's group combined bbox on
 * the SOURCE canvas) lets grouped pairs — CTA label + pill/underline, badge +
 * label — reflow through one shared anchor instead of splitting apart.
 * `containerBox` (the layout panel the element sits inside, source-space) makes
 * it reflow horizontally against that panel instead of the whole canvas.
 */
export const seedCopy = (
  el: DesignerElement,
  sourceOutput: TypeBasisCanvas,
  targetOutput: TypeBasisCanvas & { formatId?: string },
  originId: string | undefined,
  groupBox?: GroupBox,
  containerBox?: GroupBox
): DesignerElement => {
  const smart = smartReflow(
    el,
    sourceOutput,
    targetOutput,
    groupBox,
    containerBox
  );
  const newW = smart.width ?? el.width;
  const newH = smart.height ?? el.height;
  const base: DesignerElement = JSON.parse(JSON.stringify(el));
  const copy: DesignerElement = {
    ...base,
    id: genId(),
  };
  if (originId) copy.originId = originId;
  else delete copy.originId;
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

export const seedChildren = (
  elements: DesignerElement[],
  sourceOutput: TypeBasisCanvas,
  targetOutput: TypeBasisCanvas & { formatId?: string },
  originIdFor: (el: DesignerElement) => string | undefined
): DesignerElement[] => {
  const groupBoxes = computeGroupBoxes(elements, sourceOutput);
  const stackBoxes = computeTextStackBoxes(elements, sourceOutput);
  const containerBoxes = computeContainerBoxes(elements);
  const copies = elements.map((el) =>
    seedCopy(
      el,
      sourceOutput,
      targetOutput,
      originIdFor(el),
      stackBoxes.get(el) ?? (el.groupId ? groupBoxes.get(el.groupId) : undefined),
      containerBoxes.get(el)
    )
  );
  const idMap = new Map(elements.map((el, index) => [el.id, copies[index].id]));
  return copies.map((copy, index) => {
    const parentId = elements[index].parentId;
    return parentId ? { ...copy, parentId: idMap.get(parentId) ?? parentId } : copy;
  });
};
