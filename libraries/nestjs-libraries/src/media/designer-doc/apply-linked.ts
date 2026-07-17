import type {
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
} from './designer-doc.schema';

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
    const newChildren = (out as DesignerOutput).children.map((el) => {
      if (el.originId && origins.has(el.originId)) {
        changed = true;
        return { ...el, ...shared };
      }
      return el;
    });
    if (changed) affected.push(i);
    return { ...out, children: newChildren };
  });

  return { outputs, affected };
};
