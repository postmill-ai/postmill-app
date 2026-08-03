'use client';

import { runFilter } from './filter-runner';
import { commitBuffer, seedBufferFromImage } from './raster-layers';
import {
  enabledSmartFilters,
  smartFilterSource,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/smart-filter-stack';
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

/**
 * What size a bake runs at: the SOURCE's own dimensions, never the element's
 * box.
 *
 * Baking into the box stretched the source to fit — the 5-argument `drawImage`
 * ignores aspect — so adding any filter to a `fitMode: 'cover'` photo whose
 * aspect differed from its frame silently squashed it, and left
 * `naturalWidth`/`naturalHeight` describing an image that no longer existed. A
 * stack is a pixel operation; it must not move geometry.
 *
 * It also has to match what the server renderer does with the same recipe, or
 * one document renders two ways — and spatial filters are resolution-dependent,
 * so "the source's own size" is the only definition both can reach without also
 * agreeing on layout.
 */
export const bakeDimensions = (img: {
  naturalWidth?: number;
  naturalHeight?: number;
  width?: number;
  height?: number;
}): { width: number; height: number } => ({
  width: Math.max(1, Math.round(img.naturalWidth || img.width || 1)),
  height: Math.max(1, Math.round(img.naturalHeight || img.height || 1)),
});

/** Load an image URL into a fresh canvas, or null if it cannot be read. */
const loadToCanvas = (src: string) =>
  new Promise<HTMLCanvasElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const { width, height } = bakeDimensions(img);
      canvas.width = width;
      canvas.height = height;
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
 * Re-exported from the shared module so the client and the server renderer
 * cannot drift on the one rule that matters most here.
 */
export const bakeSource = smartFilterSource;

/**
 * Re-run a layer's whole stack from its original pixels and upload the result.
 *
 * Always from `originalSrc`, never from the current `src` — re-baking the
 * already-baked bitmap compounds the effect on every parameter tweak, which is
 * the trap this whole design exists to avoid.
 *
 * This runs the stack through the WORKER, which the server cannot do; what both
 * sides share is which entries apply and in what order (`enabledSmartFilters`)
 * and which pixels they start from (`smartFilterSource`).
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
  const canvas = await loadToCanvas(source);
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

  for (const entry of enabledSmartFilters(element.smartFilters)) {
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
