import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSafeFetch = vi.fn();
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

import { StockMediaService } from './stock-media.service';
import { ContentPackDailyCapError } from './content-packs/content-pack.interface';

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 403,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeService() {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const contentPacks = {
    getActiveForCapability: vi.fn().mockResolvedValue(null),
  };
  const resolution = {};
  const service = new StockMediaService(
    redis as never,
    contentPacks as never,
    resolution as never,
  );
  return { service, redis, contentPacks };
}

describe('StockMediaService', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  describe('0.3 — triggerDownload restricts the Unsplash key to api.unsplash.com', () => {
    it('sends NO request for a non-Unsplash public host', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      const { service } = makeService();

      await service.triggerDownload('https://evil.example/collect');

      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it('sends NO request for a non-https api.unsplash.com URL', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      const { service } = makeService();

      await service.triggerDownload('http://api.unsplash.com/photos/x/download');

      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it('fires for a genuine https api.unsplash.com location', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      mockSafeFetch.mockResolvedValue(jsonResponse({}));
      const { service } = makeService();

      await service.triggerDownload(
        'https://api.unsplash.com/photos/abc/download?ixid=1',
      );

      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      expect(mockSafeFetch.mock.calls[0][0]).toContain('api.unsplash.com');
    });

    it('is a no-op when no Unsplash key is configured', async () => {
      delete process.env.UNSPLASH_ACCESS_KEY;
      const { service } = makeService();

      await service.triggerDownload('https://api.unsplash.com/photos/x/download');

      expect(mockSafeFetch).not.toHaveBeenCalled();
    });
  });

  describe('1.7 — content-pack search errors do not 500 the search', () => {
    function withActivePack(
      ctx: ReturnType<typeof makeService>,
      search: ReturnType<typeof vi.fn>,
    ) {
      ctx.contentPacks.getActiveForCapability.mockResolvedValue({
        capability: { search },
        active: { identifier: 'magnific', version: 'v1' },
      });
      return ctx;
    }

    it('rethrows ContentPackDailyCapError (→ 402 via the exception filter)', async () => {
      const ctx = makeService();
      const search = vi.fn().mockRejectedValue(
        new ContentPackDailyCapError('Daily cap reached'),
      );
      withActivePack(ctx, search);

      await expect(ctx.service.searchPhotos('org-1', 'cats', 1)).rejects.toBeInstanceOf(
        ContentPackDailyCapError,
      );
    });

    it('degrades a generic pack failure to the free provider (no throw)', async () => {
      delete process.env.UNSPLASH_ACCESS_KEY; // free path returns configured:false
      const ctx = makeService();
      const search = vi.fn().mockRejectedValue(new Error('pack 500 <html>'));
      withActivePack(ctx, search);

      const result = await ctx.service.searchPhotos('org-1', 'cats', 1);

      expect(search).toHaveBeenCalled();
      expect(result.source).toBe('unsplash');
      expect(result.configured).toBe(false);
    });

    it('caches pack results under an ORG-SCOPED key (never the global stock: namespace)', async () => {
      const ctx = makeService();
      const search = vi.fn().mockResolvedValue({
        results: [],
        page: 1,
        totalPages: 1,
        configured: true,
        source: 'magnific',
      });
      withActivePack(ctx, search);

      await ctx.service.searchPhotos('org-1', 'cats', 1);

      expect(ctx.redis.set).toHaveBeenCalledTimes(1);
      const key = ctx.redis.set.mock.calls[0][0] as string;
      expect(key.startsWith('stock-pack:org-1:')).toBe(true);
      expect(key.startsWith('stock:')).toBe(false);
    });
  });

  describe('6.3 — Unsplash res.ok guard', () => {
    it('returns the empty configured:true shape when Unsplash responds non-2xx', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      mockSafeFetch.mockResolvedValue(jsonResponse({}, false)); // 403 text/plain in reality
      const { service } = makeService();

      const result = await service.searchPhotos('org-1', 'cats', 1);

      expect(result.configured).toBe(true);
      expect(result.results).toEqual([]);
    });
  });
});
