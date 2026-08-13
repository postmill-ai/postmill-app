/**
 * A bounded memoiser for async loads.
 *
 * The PROMISE is cached, not the awaited value, so N concurrent callers for
 * the same key share one in-flight load; failures settle as a cached value
 * too (callers that want retries must not swallow rejections into the cache).
 * Eviction is insertion-order (Map order), which for this use — "same handful
 * of bitmaps across a render's outputs" — is indistinguishable from true LRU.
 */
export class PromiseLruCache<V> {
  private readonly map = new Map<string, Promise<V>>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string, load: () => Promise<V>): Promise<V> {
    const cached = this.map.get(key);
    if (cached) return cached;
    const promise = load();
    this.map.set(key, promise);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return promise;
  }
}
