// Throttle for render-progress reporting. Dependency-free by design: BOTH the host
// (in-process render path) and the container worker (media-render-worker.ts) import
// it — the worker must not pull the Redis client module into the container.

export interface ProgressThrottleOptions {
  /** Write at most once per this many frames (default 10). */
  frameStride?: number;
  /** …or at most once per this interval, whichever comes first (default 2000 ms). */
  intervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface ProgressReporter {
  /** Report a captured frame (1-based global count). Fire-and-forget. */
  report: (frame: number, total: number) => void;
  /** Settle every queued write (await before process exit / job teardown). */
  flush: () => Promise<void>;
}

/**
 * Wrap a progress write (Redis SET host-side, HTTP POST from the container) so it
 * fires on the first frame, then every `frameStride` frames or `intervalMs` —
 * whichever comes first — and always on the final frame. Writes are serialized
 * through a promise chain so a slow write can't reorder progress backwards, and
 * failures are swallowed: progress is best-effort and must never fail a render.
 */
export function createThrottledProgressWriter(
  write: (frame: number, total: number) => Promise<void> | void,
  opts: ProgressThrottleOptions = {},
): ProgressReporter {
  const stride = opts.frameStride ?? 10;
  const interval = opts.intervalMs ?? 2000;
  const now = opts.now ?? (() => Date.now());
  let lastFrame = -Infinity;
  let lastTime = -Infinity;
  let tail: Promise<void> = Promise.resolve();

  return {
    report(frame: number, total: number) {
      const t = now();
      const isFinal = frame >= total;
      if (!isFinal && frame - lastFrame < stride && t - lastTime < interval) return;
      lastFrame = frame;
      lastTime = t;
      tail = tail.then(() => write(frame, total)).catch(() => {});
    },
    flush: () => tail,
  };
}
