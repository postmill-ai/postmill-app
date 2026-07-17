import { describe, it, expect, vi, beforeEach } from 'vitest';


import { TlyAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext, ShortLinkStat } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { apiToken: 'test-token' },
};

function mockResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
  } as Response;
}

describe('TlyAdapter', () => {
  let adapter: TlyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TlyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "tly"', () => {
      expect(adapter.identifier).toBe('tly');
    });

    it('has name "T.LY"', () => {
      expect(adapter.name).toBe('T.LY');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "t.ly"', () => {
      expect(adapter.defaultDomain).toBe('t.ly');
    });

    it('has credentialFields with apiToken', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiToken');
      const field = adapter.credentialFields.find((f) => f.key === 'apiToken');
      expect(field?.required).toBe(true);
      expect(field?.type).toBe('password');
    });

    it('has all capabilities enabled', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: true,
        statistics: true,
        bulkStatistics: true,
        customDomain: true,
      });
    });
  });

  describe('resolveDomain', () => {
    it('returns customDomain when provided', () => {
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };
      expect(adapter.resolveDomain(ctx)).toBe('my.link');
    });

    it('returns defaultDomain when no customDomain', () => {
      expect(adapter.resolveDomain(mockContext)).toBe('t.ly');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://t.ly/api/v1/link/shorten', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('T.LY API error (401)');

      fetchSpy.mockRestore();
    });

    it('returns ok: false on network error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Network error');

      fetchSpy.mockRestore();
    });
  });

  describe('createShortLink', () => {
    it('creates short link and returns shortUrl with providerLinkId', async () => {
      const responseBody = { short_url: 'https://t.ly/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://t.ly/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://t.ly/api/v1/link/shorten', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to link field when short_url is absent', async () => {
      const responseBody = { link: 'https://t.ly/fallback', hash: 'fb456' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://t.ly/fallback');
      expect(result.providerLinkId).toBe('fb456');

      fetchSpy.mockRestore();
    });

    it('includes domain in request body when customDomain is provided', async () => {
      const responseBody = { short_url: 'https://my.link/abc' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };

      const result = await adapter.createShortLink(ctx, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://my.link/abc');

      const callArgs = (safeFetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.domain).toBe('my.link');

      fetchSpy.mockRestore();
    });

    it('throws on API error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('T.LY create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { long_url: 'https://example.com/original' }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://t.ly/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith('https://t.ly/api/v1/link/expand', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to original_url field when long_url is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { original_url: 'https://example.com/alt' }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://t.ly/abc123');
      expect(result).toBe('https://example.com/alt');

      fetchSpy.mockRestore();
    });

    it('returns empty string when neither field present', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.expandShortLink(mockContext, 'https://t.ly/abc123');
      expect(result).toBe('');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://t.ly/abc123'))
        .rejects.toThrow('T.LY expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { long_url: 'https://orig.com/1', total_clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { long_url: 'https://orig.com/2', clicks: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://t.ly/a', 'https://t.ly/b']);
      expect(result).toEqual([
        { short: 'https://t.ly/a', original: 'https://orig.com/1', clicks: '42' },
        { short: 'https://t.ly/b', original: 'https://orig.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://t.ly/a']);
      expect(result).toEqual([{ short: 'https://t.ly/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('skips links that return non-ok response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      const result = await adapter.linkStatistics(mockContext, ['https://t.ly/a']);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = {
        links: [
          { short_url: 'https://t.ly/a', long_url: 'https://example.com/1', clicks: 5 },
          { short_url: 'https://t.ly/b', long_url: 'https://example.com/2', total_clicks: 3 },
        ],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://t.ly/a', original: 'https://example.com/1', clicks: '5' },
        { short: 'https://t.ly/b', original: 'https://example.com/2', clicks: '3' },
      ]);

      fetchSpy.mockRestore();
    });

    it('handles wrapped response with data key', async () => {
      const responseBody = {
        data: [{ short_url: 'https://t.ly/x', long_url: 'https://example.com/x', clicks: 1 }],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 2);
      expect(result).toEqual([
        { short: 'https://t.ly/x', original: 'https://example.com/x', clicks: '1' },
      ]);

      fetchSpy.mockRestore();
    });

    it('falls back to link field when short_url is absent', async () => {
      const responseBody = {
        links: [{ link: 'https://t.ly/y', original_url: 'https://example.com/y', clicks: 2 }],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://t.ly/y', original: 'https://example.com/y', clicks: '2' },
      ]);

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('T.LY list failed (500)');

      fetchSpy.mockRestore();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      await adapter.validateCredentials(mockContext);
      expect(safeFetch).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
