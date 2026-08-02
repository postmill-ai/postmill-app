import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
} from './designer-doc.schema';
import { typeScaleRatio } from './reflow';

// Geometry is per-format and never propagates; everything else (style/content)
// syncs to same-originId copies in the other outputs.
export const GEOMETRY_KEYS = new Set([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'fitMode',
  'focalPoint',
  'crop',
  'anchor',
]);

const sharedUpdates = (
  updates: Partial<DesignerElement>
): Partial<DesignerElement> => {
  const out: Partial<DesignerElement> = {};
  for (const k of Object.keys(updates) as Array<keyof DesignerElement>) {
    if (!GEOMETRY_KEYS.has(k)) {
      (out as any)[k] = (updates as any)[k];
    }
  }
  return out;
};

const isImageOutput = (
  out: DesignerOutput | VideoOutput
): out is DesignerOutput => 'children' in out;

/**
 * Non-geometry updates propagate raw — except `fontSize`: a px value authored
 * against one canvas is wrong on another, so linked copies get it re-fit
 * through the shared aspect-aware basis (`typeScaleRatio`, the same rule as
 * smartReflow and the conductor's variant re-fit), floored at 10px. The old
 * `min(scaleX, scaleY)` here silently re-imposed short-edge typography on
 * every linked edit — undoing the per-format type of every wider output.
 */
const scaledForOutput = (
  shared: Partial<DesignerElement>,
  source: { width: number; height: number },
  target: { width: number; height: number }
): Partial<DesignerElement> => {
  if (typeof shared.fontSize !== 'number' || !Number.isFinite(shared.fontSize)) {
    return shared;
  }
  return {
    ...shared,
    fontSize: Math.max(
      10,
      Math.round(shared.fontSize * typeScaleRatio(source, target))
    ),
  };
};

/**
 * Apply `updates` to the elements matched by `ids` on the current output, then
 * propagate any non-geometry updates to linked copies (same `originId`) on the
 * other image outputs. When `editFormatOnly` is true the propagation step is
 * skipped, matching the front-end "Edit format only" toggle.
 */
export const applyLinked = (
  doc: DesignerDoc,
  currentOutputIndex: number,
  ids: Set<string> | string[],
  updates: Partial<DesignerElement>,
  editFormatOnly: boolean
): { outputs: (DesignerOutput | VideoOutput)[]; affected: number[] } => {
  const idSet = ids instanceof Set ? ids : new Set(ids);
  const current = doc.outputs[currentOutputIndex] as DesignerOutput;
  const origins = new Set(
    current.children
      .filter((el) => idSet.has(el.id) && el.originId)
      .map((el) => el.originId as string)
  );
  const shared = sharedUpdates(updates);
  const propagate =
    !editFormatOnly && origins.size > 0 && Object.keys(shared).length > 0;
  const affected: number[] = [];

  const outputs = doc.outputs.map((out, i) => {
    if (i === currentOutputIndex) {
      return {
        ...out,
        children: (out as DesignerOutput).children.map((el) =>
          idSet.has(el.id) ? { ...el, ...updates } : el
        ),
      };
    }
    if (!propagate || !isImageOutput(out)) return out;

    let changed = false;
    const scaled = scaledForOutput(shared, current, out as DesignerOutput);
    const newChildren = (out as DesignerOutput).children.map((el) => {
      if (el.originId && origins.has(el.originId)) {
        changed = true;
        return { ...el, ...scaled };
      }
      return el;
    });
    if (changed) affected.push(i);
    return { ...out, children: newChildren };
  });

  return { outputs, affected };
};
