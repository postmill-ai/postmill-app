import { applyFilter, type FilterParams } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-ops';
import type { FilterResponse } from './filter.worker';

/**
 * Running a filter, off the main thread when it can be.
 *
 * Worker construction is wrapped because the two bundlers this repo uses
 * (`dev:frontend` on Turbopack, `dev:webpack` on webpack) resolve
 * `new Worker(new URL(...))` differently, and a build that can't produce the
 * worker chunk must degrade to a slower editor rather than a broken menu. The
 * fallback runs the identical function, so results never differ — only the
 * responsiveness does.
 */

export interface RunOptions {
  /** Abort a long-running filter. Resolves to null when cancelled. */
  signal?: AbortSignal;
}

const createWorker = (): Worker | null => {
  try {
    return new Worker(new URL('./filter.worker.ts', import.meta.url));
  } catch {
    return null;
  }
};

/** True when the browser can run filters off the main thread. */
export const workersAvailable = (): boolean => {
  if (typeof Worker === 'undefined') return false;
  const probe = createWorker();
  probe?.terminate();
  return !!probe;
};

/**
 * Apply `id` to `data`, in place semantics: the returned ImageData holds the
 * result, and is the same object when the main-thread path is taken.
 *
 * Returns null if the run was cancelled.
 */
export const runFilter = async (
  data: ImageData,
  id: string,
  params: FilterParams,
  options: RunOptions = {}
): Promise<ImageData | null> => {
  if (options.signal?.aborted) return null;

  const worker = createWorker();
  if (!worker) {
    // Synchronous fallback. Nothing can interrupt it, so a cancel that arrives
    // mid-run is honoured by discarding the result rather than by stopping.
    applyFilter(
      { width: data.width, height: data.height, data: data.data },
      id,
      params
    );
    return options.signal?.aborted ? null : data;
  }

  try {
    const result = await new Promise<ImageData | null>((resolve, reject) => {
      const onAbort = () => {
        worker.terminate();
        resolve(null);
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      worker.onmessage = (event: MessageEvent<FilterResponse>) => {
        options.signal?.removeEventListener('abort', onAbort);
        const message = event.data;
        if (!message.ok || !message.data) {
          reject(new Error(message.error || 'Filter failed'));
          return;
        }
        resolve(
          new ImageData(
            new Uint8ClampedArray(message.data),
            data.width,
            data.height
          )
        );
      };
      worker.onerror = (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(new Error(err.message || 'Filter worker failed'));
      };

      // Copy before transferring: the caller's ImageData must stay usable if
      // the run is cancelled or fails.
      const copy = new Uint8ClampedArray(data.data);
      worker.postMessage(
        {
          id,
          params,
          width: data.width,
          height: data.height,
          data: copy.buffer,
        },
        [copy.buffer]
      );
    });
    return result;
  } finally {
    worker.terminate();
  }
};

/**
 * Blend a filtered result back through the selection.
 *
 * The op always sees the WHOLE layer — clipping happens here, afterwards. That
 * ordering matters for the spatial filters: a blur inside a selection has to be
 * able to read the pixels just outside it, or every selection would gain a dark
 * halo at its edge. It also means all 47 filters can ignore selections
 * completely and still respect the marching ants.
 *
 * `coverage` is layer-local, 0–255. Pure and exported so the guarantee — pixels
 * outside the selection are byte-identical — is testable.
 */
export const blendThroughCoverage = (
  // Structural rather than `ImageData`: jsdom has no such constructor, and this
  // only ever reads `.data`.
  target: { data: Uint8ClampedArray },
  filtered: { data: Uint8ClampedArray },
  coverage: Uint8ClampedArray
): void => {
  const dst = target.data;
  const src = filtered.data;
  for (let i = 0, px = 0; i < dst.length; i += 4, px++) {
    const cov = coverage[px] / 255;
    if (cov <= 0) continue;
    if (cov >= 1) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = src[i + 3];
      continue;
    }
    // A feathered edge blends rather than stepping.
    dst[i] += (src[i] - dst[i]) * cov;
    dst[i + 1] += (src[i + 1] - dst[i + 1]) * cov;
    dst[i + 2] += (src[i + 2] - dst[i + 2]) * cov;
    dst[i + 3] += (src[i + 3] - dst[i + 3]) * cov;
  }
};
