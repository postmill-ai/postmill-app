export interface RaceWithTimeoutOptions {
  signal?: AbortSignal;
  onTimeout?: () => void;
  label?: string;
}

/**
 * Race a promise against a timeout and an optional abort signal.
 *
 * - Rejects with `new Error('<label> timed out after <ms>ms')` on timeout.
 * - Rejects with `new Error('Cancelled')` when the signal aborts.
 * - Cleans up the timer and abort listener in all paths.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  opts?: RaceWithTimeoutOptions
): Promise<T> {
  const { signal, onTimeout, label } = opts ?? {};
  const timeoutMessage = label
    ? `${label} timed out after ${ms}ms`
    : `Timed out after ${ms}ms`;

  if (signal?.aborted) {
    throw new Error('Cancelled');
  }

  let timer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;

  const cleanup = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = undefined;
    }
  };

  try {
    const racers: Promise<never>[] = [
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (onTimeout) {
            onTimeout();
          }
          reject(new Error(timeoutMessage));
        }, ms);
      }),
    ];

    if (signal) {
      racers.push(
        new Promise<never>((_, reject) => {
          abortListener = () => reject(new Error('Cancelled'));
          signal.addEventListener('abort', abortListener, { once: true });
        })
      );
    }

    return await Promise.race([promise, ...racers]);
  } finally {
    cleanup();
  }
}
