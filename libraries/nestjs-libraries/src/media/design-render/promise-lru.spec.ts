import { describe, it, expect, vi } from 'vitest';
import { PromiseLruCache } from './promise-lru';

describe('PromiseLruCache', () => {
  it('loads each key once, even concurrently', async () => {
    const cache = new PromiseLruCache<number>(4);
    const load = vi.fn(async () => 42);
    const [a, b] = await Promise.all([
      cache.get('k', load),
      cache.get('k', load),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('caches settled nulls — a failed lookup is not retried', async () => {
    const cache = new PromiseLruCache<null>(4);
    const load = vi.fn(async () => null);
    await cache.get('missing', load);
    await cache.get('missing', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest entry beyond the cap', async () => {
    const cache = new PromiseLruCache<number>(2);
    const load = vi.fn(async () => 1);
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load); // evicts 'a'
    expect(cache.size).toBe(2);
    await cache.get('a', load); // 'a' loads again
    expect(load).toHaveBeenCalledTimes(4);
    await cache.get('b', load); // 'b' was evicted by the re-add of 'a'
    expect(load).toHaveBeenCalledTimes(5);
  });
});
