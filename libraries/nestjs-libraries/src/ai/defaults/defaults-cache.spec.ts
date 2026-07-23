import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    keys: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { bustDefaultsCatalogCache, getOrCacheModelList } from './defaults-cache';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';

describe('bustDefaultsCatalogCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes keys for both AI and media catalog prefixes', async () => {
    (ioRedis.keys as ReturnType<typeof vi.fn>).mockResolvedValue(['key1', 'key2']);

    bustDefaultsCatalogCache('org-1');
    // Give the fire-and-forget promises a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ioRedis.keys).toHaveBeenCalledTimes(2);
    expect(ioRedis.keys).toHaveBeenCalledWith(
      'settings:ai:defaults:catalog:org-1:*'
    );
    expect(ioRedis.keys).toHaveBeenCalledWith(
      'settings:content:media-defaults:catalog:org-1:*'
    );
    expect(ioRedis.del).toHaveBeenCalledWith('key1', 'key2');
  });

  it('does not call del when no keys match', async () => {
    (ioRedis.keys as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    bustDefaultsCatalogCache('org-2');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ioRedis.keys).toHaveBeenCalledTimes(2);
    expect(ioRedis.del).not.toHaveBeenCalled();
  });

  it('swallows Redis errors non-fatally', async () => {
    (ioRedis.keys as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('redis down')
    );

    expect(() => bustDefaultsCatalogCache('org-3')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ioRedis.del).not.toHaveBeenCalled();
  });
});

describe('getOrCacheModelList', () => {
  const creds = { apiKey: 'sk-test', baseURL: 'https://api.example.com/v1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches on a miss and caches the result for 24h', async () => {
    (ioRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (ioRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    const models = [{ id: 'm-1' }, { id: 'm-2' }];
    const fetcher = vi.fn().mockResolvedValue(models);

    const result = await getOrCacheModelList('ai', 'deepseek', 'v1', creds, fetcher);

    expect(result).toEqual(models);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [key, payload, ex, ttl] = (ioRedis.set as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toMatch(/^providers:models:ai:deepseek:v1:[0-9a-f]{16}$/);
    expect(key).not.toContain('sk-test');
    expect(JSON.parse(payload)).toEqual(models);
    expect(ex).toBe('EX');
    expect(ttl).toBe(24 * 60 * 60);
  });

  it('serves from the cache without calling the fetcher', async () => {
    const models = [{ id: 'cached' }];
    (ioRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(models));
    const fetcher = vi.fn();

    const result = await getOrCacheModelList('ai', 'deepseek', 'v1', creds, fetcher);

    expect(result).toEqual(models);
    expect(fetcher).not.toHaveBeenCalled();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('does not cache empty or failed results', async () => {
    (ioRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const empty = await getOrCacheModelList('ai', 'groq', 'v1', creds, vi.fn().mockResolvedValue([]));
    expect(empty).toEqual([]);

    const failed = await getOrCacheModelList('ai', 'groq', 'v1', creds, vi.fn().mockResolvedValue(undefined));
    expect(failed).toBeUndefined();

    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('falls through to the fetcher when Redis is down', async () => {
    (ioRedis.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('redis down'));
    (ioRedis.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('redis down'));
    const models = [{ id: 'fresh' }];
    const fetcher = vi.fn().mockResolvedValue(models);

    const result = await getOrCacheModelList('media', 'fal', 'v1', creds, fetcher);

    expect(result).toEqual(models);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keys by credential hash so different keys get different cache entries', async () => {
    (ioRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (ioRedis.set as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    const fetcher = vi.fn().mockResolvedValue([{ id: 'm' }]);

    await getOrCacheModelList('ai', 'openai', 'v1', { apiKey: 'key-a' }, fetcher);
    await getOrCacheModelList('ai', 'openai', 'v1', { apiKey: 'key-b' }, fetcher);

    const keys = (ioRedis.set as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
