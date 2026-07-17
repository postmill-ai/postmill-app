// Run `fn` over `items` with at most `concurrency` calls in flight at once, preserving
// input order in the returned array. Bounds load on rate-limited / CPU-heavy fan-outs
// (e.g. live analytics provider calls, per-post comment sync) — never an unbounded
// Promise.all. Errors propagate; callers needing per-item resilience should try/catch
// inside `fn`.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

// Collapse concurrent same-key async calls into one in-flight computation (a stampede guard).
// The first caller for a key runs `fn`; any caller arriving while it is still pending awaits the
// same promise; the entry is dropped once it settles, so the next call recomputes. Per-instance
// only — backed by an in-process Map, NOT cross-replica.
const _inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = _inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      _inFlight.delete(key);
    });

  _inFlight.set(key, promise);
  return promise;
}
