import { applyFilter, type FilterParams } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-ops';

/**
 * Runs a filter off the main thread.
 *
 * Median at a large radius, the bilateral blurs and the cell filters are
 * O(pixels × radius²) — seconds of work on a full-size layer. On the main
 * thread that freezes the canvas and can trip the browser's unresponsive-page
 * warning, so the pixels come here instead.
 *
 * The op itself is imported, not reimplemented: the worker, the main-thread
 * fallback and the unit tests all run the exact same `applyFilter`.
 */

export interface FilterRequest {
  id: string;
  params: FilterParams;
  width: number;
  height: number;
  /** Transferred, not copied — the buffer belongs to the worker after posting. */
  data: ArrayBuffer;
}

export interface FilterResponse {
  ok: boolean;
  error?: string;
  data?: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<FilterRequest>) => {
  const { id, params, width, height, data } = event.data;
  try {
    const buf = {
      width,
      height,
      data: new Uint8ClampedArray(data),
    };
    applyFilter(buf, id, params);
    const out = buf.data.buffer as ArrayBuffer;
    (self as unknown as Worker).postMessage({ ok: true, data: out } as FilterResponse, [out]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: (err as Error)?.message || 'Filter failed',
    } as FilterResponse);
  }
};
