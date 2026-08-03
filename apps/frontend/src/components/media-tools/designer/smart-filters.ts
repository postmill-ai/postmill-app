'use client';

import { runFilter } from './filter-runner';
import { commitBuffer, seedBufferFromImage } from './raster-layers';
import { filterById } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-descriptors';
import { MAX_SMART_FILTERS } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type {
  DesignerElement,
  DesignerSmartFilter,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import type { FilterParams } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-ops';

/**
 * Non-destructive filters, kept as a recipe rather than as pixels.
 *
 * The stack is re-evaluated on the client from `originalSrc` and the result
 * uploaded to `src`, so the three renderers keep drawing a plain bitmap and
 * need no filter code at all. That is the whole trade: editable-forever filters
 * for one implementation instead of 47 × 3.
 */

/** Stack edits. Pure, so the ordering rules are testable without a canvas. */

export const addSmartFilter = (
  stack: DesignerSmartFilter[] | undefined,
  id: string,
  params?: FilterParams
): DesignerSmartFilter[] => {
  const list = stack || [];
  if (list.length >= MAX_SMART_FILTERS) return list;
  return [...list, { id, params: params as DesignerSmartFilter['params'] }];
};

export const removeSmartFilter = (
  stack: DesignerSmartFilter[] | undefined,
  index: number
): DesignerSmartFilter[] => (stack || []).filter((_, i) => i !== index);

export const toggleSmartFilter = (
  stack: DesignerSmartFilter[] | undefined,
  index: number
): DesignerSmartFilter[] =>
  (stack || []).map((f, i) =>
    i === index ? { ...f, enabled: f.enabled === false } : f
  );

export const updateSmartFilterParams = (
  stack: DesignerSmartFilter[] | undefined,
  index: number,
  params: FilterParams
): DesignerSmartFilter[] =>
  (stack || []).map((f, i) =>
    i === index ? { ...f, params: params as DesignerSmartFilter['params'] } : f
  );

/** Move an entry within the stack. Order is the effect, so this is not cosmetic. */
export const reorderSmartFilter = (
  stack: DesignerSmartFilter[] | undefined,
  from: number,
  to: number
): DesignerSmartFilter[] => {
  const list = [...(stack || [])];
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  const [moved] = list.splice(from, 1);
  list.splice(target, 0, moved);
  return list;
};

/** Load an image URL into a fresh canvas, or null if it cannot be read. */
const loadToCanvas = (src: string, width: number, height: number) =>
  new Promise<HTMLCanvasElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width || img.naturalWidth));
      canvas.height = Math.max(1, Math.round(height || img.naturalHeight));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

export interface RebakeResult {
  src: string;
  fileId?: string;
}

/**
 * Which pixels a re-bake reads from.
 *
 * `originalSrc` always wins. Falling back to `src` is only for the very first
 * bake, before the original has been frozen — after that, reading `src` would
 * feed the already-filtered bitmap back through the stack and compound the
 * effect on every parameter tweak.
 */
export const bakeSource = (
  element: Pick<DesignerElement, 'originalSrc' | 'src'>
): string | undefined => element.originalSrc || element.src;

/**
 * Re-run a layer's whole stack from its original pixels and upload the result.
 *
 * Always from `originalSrc`, never from the current `src` — re-baking the
 * already-baked bitmap compounds the effect on every parameter tweak, which is
 * the trap this whole design exists to avoid.
 */
export const rebakeSmartFilters = async (
  element: Pick<
    DesignerElement,
    'id' | 'width' | 'height' | 'originalSrc' | 'src' | 'smartFilters'
  >,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  options: { signal?: AbortSignal } = {}
): Promise<RebakeResult | null> => {
  const source = bakeSource(element);
  if (!source) return null;

  const bakeId = `${element.id}:smart`;
  const canvas = await loadToCanvas(source, element.width, element.height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    // A tainted canvas cannot be read back; leave the layer as it is.
    return null;
  }

  for (const entry of element.smartFilters || []) {
    if (entry.enabled === false) continue;
    if (!filterById(entry.id)) continue;
    if (options.signal?.aborted) return null;
    const result = await runFilter(
      data,
      entry.id,
      (entry.params || {}) as FilterParams,
      { signal: options.signal }
    );
    if (result) data = result;
  }

  ctx.putImageData(data, 0, 0);

  // Route the upload through the buffer machinery so a re-bake takes the same
  // path a painted layer does — one upload implementation, not two.
  seedBufferFromImage(bakeId, canvas as never, canvas.width, canvas.height);
  const committed = await commitBuffer(bakeId, fetchFn);
  return committed;
};

/**
 * What an element becomes when its filters are flattened: the baked `src` stays
 * as the layer's pixels, the recipe and the pre-filter original are discarded.
 * There is no way back afterwards, which is exactly what flattening means.
 */
export const flattenSmartFilters = (): Partial<DesignerElement> => ({
  smartFilters: undefined,
  originalSrc: undefined,
  originalFileId: undefined,
});
