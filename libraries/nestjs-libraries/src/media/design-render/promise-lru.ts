/**
 * A bounded memoiser for async loads. Concurrent callers share one promise.
 * Null and rejected results can expire after a caller-supplied failure TTL.
 */
export class PromiseLruCache<V> {
  private readonly map = new Map<string, {
    promise: Promise<V>;
    failedAt?: number;
  }>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get(
    key: string,
    load: () => Promise<V>,
    opts?: { failureTtlMs?: number }
  ): Promise<V> {
    const cached = this.map.get(key);
    if (cached) {
      const expired = opts?.failureTtlMs !== undefined &&
        cached.failedAt !== undefined &&
        Date.now() - cached.failedAt >= opts.failureTtlMs;
      if (!expired) return cached.promise;
      this.map.delete(key);
    }
    const entry: { promise: Promise<V>; failedAt?: number } = {
      promise: load(),
    };
    this.map.set(key, entry);
    void entry.promise.then(
      (value) => {
        if (value === null) entry.failedAt = Date.now();
      },
      () => {
        entry.failedAt = Date.now();
      }
    );
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return entry.promise;
  }
}
