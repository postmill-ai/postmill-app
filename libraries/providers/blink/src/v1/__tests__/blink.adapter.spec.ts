import { describe, it, expect, vi, beforeEach } from 'vitest';


import { BlinkAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext, ShortLinkStat } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { apiKey: 'test-api-key' },
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

describe('BlinkAdapter', () => {
  let adapter: BlinkAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BlinkAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "blink"', () => {
      expect(adapter.identifier).toBe('blink');
    });

    it('has name "BL.INK"', () => {
      expect(adapter.name).toBe('BL.INK');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "bl.ink"', () => {
      expect(adapter.defaultDomain).toBe('bl.ink');
    });

    it('has credentialFields with apiKey', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      const field = adapter.credentialFields.find((f) => f.key === 'apiKey');
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
      expect(adapter.resolveDomain(mockContext)).toBe('bl.ink');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.bl.ink/api/v1/links?limit=1', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-Key': 'test-api-key' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('BL.INK API error (401)');

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
      const responseBody = { slug: 'abc123', id: 'link-1' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://bl.ink/abc123');
      expect(result.providerLinkId).toBe('link-1');
      expect(safeFetch).toHaveBeenCalledWith('https://api.bl.ink/api/v1/links', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to id when slug is absent in shortUrl', async () => {
      const responseBody = { id: 'link-2' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://bl.ink/link-2');

      fetchSpy.mockRestore();
    });

    it('uses customDomain in request body and shortUrl', async () => {
      const responseBody = { slug: 'abc', id: 'link-3' };
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
        .rejects.toThrow('BL.INK create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: 'https://example.com/original' }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://bl.ink/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/link/abc123'),
        expect.objectContaining({ method: 'GET' }),
      );

      fetchSpy.mockRestore();
    });

    it('falls back to destination field when url is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { destination: 'https://example.com/alt' }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://bl.ink/abc123');
      expect(result).toBe('https://example.com/alt');

      fetchSpy.mockRestore();
    });

    it('returns empty string when neither url nor destination present', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.expandShortLink(mockContext, 'https://bl.ink/abc123');
      expect(result).toBe('');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://bl.ink/abc123'))
        .rejects.toThrow('BL.INK expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { url: 'https://orig.com/1', clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { destination: 'https://orig.com/2', total_clicks: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://bl.ink/a', 'https://bl.ink/b']);
      expect(result).toEqual([
        { short: 'https://bl.ink/a', original: 'https://orig.com/1', clicks: '42' },
        { short: 'https://bl.ink/b', original: 'https://orig.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://bl.ink/a']);
      expect(result).toEqual([{ short: 'https://bl.ink/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('skips links that return non-ok response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      const result = await adapter.linkStatistics(mockContext, ['https://bl.ink/a']);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = [
        { slug: 'a', domain: 'bl.ink', url: 'https://example.com/1', clicks: 5 },
        { slug: 'b', domain: 'bl.ink', url: 'https://example.com/2', total_clicks: 3 },
      ];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://bl.ink/a', original: 'https://example.com/1', clicks: '5' },
        { short: 'https://bl.ink/b', original: 'https://example.com/2', clicks: '3' },
      ]);

      fetchSpy.mockRestore();
    });

    it('handles wrapped response with links key', async () => {
      const responseBody = {
        links: [{ slug: 'x', domain: 'my.link', destination: 'https://example.com/x', clicks: 1 }],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 2);
      expect(result).toEqual([
        { short: 'https://my.link/x', original: 'https://example.com/x', clicks: '1' },
      ]);

      fetchSpy.mockRestore();
    });

    it('uses correct pagination params for page > 1', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, []));

      await adapter.listLinks(mockContext, 3);
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=100'),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('BL.INK list failed (500)');

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
