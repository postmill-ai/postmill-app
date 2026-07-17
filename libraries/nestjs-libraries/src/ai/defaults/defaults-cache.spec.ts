import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    keys: vi.fn(),
    del: vi.fn(),
  },
}));

import { bustDefaultsCatalogCache } from './defaults-cache';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

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
