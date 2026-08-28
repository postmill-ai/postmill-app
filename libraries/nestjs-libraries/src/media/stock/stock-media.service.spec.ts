import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSafeFetch = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
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

  describe('provider failure surfaces a safe error message', () => {
    it('ok path is unchanged — no error field on a successful search', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      mockSafeFetch.mockResolvedValue(
        jsonResponse({ results: [], total_pages: 0 }),
      );
      const { service } = makeService();

      const result = await service.searchPhotos('org-1', 'cats', 1);

      expect(result.configured).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('!res.ok populates error with the HTTP status and keeps results empty', async () => {
      process.env.PIXABAY_API_KEY = 'bad-key';
      mockSafeFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '[ERROR 400] Invalid API key',
      });
      const { service } = makeService();

      const result = await service.searchVectors('org-1', 'cats', 1);

      expect(result.configured).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.error).toBe('pixabay request failed (HTTP 400)');
      // The error message must never leak the key or the response body.
      expect(result.error).not.toContain('bad-key');
      expect(result.error).not.toContain('Invalid API key');
    });

    it('missing key still returns configured:false with no error field', async () => {
      delete process.env.PIXABAY_API_KEY;
      const { service } = makeService();

      const result = await service.searchVectors('org-1', 'cats', 1);

      expect(mockSafeFetch).not.toHaveBeenCalled();
      expect(result.configured).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('jamendo !res.ok surfaces an error instead of misreporting configured:false', async () => {
      process.env.JAMENDO_CLIENT_ID = 'client-id';
      mockSafeFetch.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => 'unauthorized',
      });
      const { service } = makeService();

      const result = await service.searchAudio('org-1', 'lofi', 1);

      expect(result.configured).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.error).toBe('jamendo request failed (HTTP 401)');
    });

    it('jamendo network/parse failure keeps configured:true with a safe error', async () => {
      process.env.JAMENDO_CLIENT_ID = 'client-id';
      mockSafeFetch.mockRejectedValue(new Error('socket hangup'));
      const { service } = makeService();

      const result = await service.searchAudio('org-1', 'lofi', 1);

      expect(result.configured).toBe(true);
      expect(result.error).toBe('jamendo request failed (network or invalid response)');
      expect(result.error).not.toContain('socket hangup');
    });
  });

  describe('C3 — brand/adult safety on the Unsplash photo search', () => {
    it('sends content_filter=high on every photo search', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      mockSafeFetch.mockResolvedValue(jsonResponse({ results: [] }));
      const { service } = makeService();

      await service.searchPhotos('org-1', 'sneakers', 1, 'landscape');

      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockSafeFetch.mock.calls[0][0] as string);
      expect(url.host).toBe('api.unsplash.com');
      // A search API has no negative-prompt lever, and the AI Designer
      // resolves hero imagery through this path — so safety is not opt-in.
      expect(url.searchParams.get('content_filter')).toBe('high');
      expect(url.searchParams.get('query')).toBe('sneakers');
      expect(url.searchParams.get('orientation')).toBe('landscape');
    });

    it('carries content_filter into the pack-adapter filters', async () => {
      process.env.UNSPLASH_ACCESS_KEY = 'secret-key';
      const search = vi.fn().mockResolvedValue({
        results: [],
        page: 1,
        totalPages: 1,
        configured: true,
        source: 'magnific',
      });
      const { service, contentPacks } = makeService();
      contentPacks.getActiveForCapability.mockResolvedValue({
        capability: { search },
        active: { identifier: 'magnific', version: 'v1' },
      });

      await service.searchPhotos('org-1', 'sneakers', 1);

      // Pack adapters forward unknown filters generically, so packs inherit
      // the same safety tier as the free Unsplash path.
      expect(search).toHaveBeenCalledTimes(1);
      expect(search.mock.calls[0][3]).toMatchObject({ content_filter: 'high' });
    });
  });
});
