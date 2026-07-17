import { describe, it, expect, vi, beforeEach } from 'vitest';


import { T2mAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

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

describe('T2mAdapter', () => {
  let adapter: T2mAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new T2mAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "t2m"', () => {
      expect(adapter.identifier).toBe('t2m');
    });

    it('has name "T2M"', () => {
      expect(adapter.name).toBe('T2M');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "t2m.io"', () => {
      expect(adapter.defaultDomain).toBe('t2m.io');
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
      expect(adapter.resolveDomain(mockContext)).toBe('t2m.io');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://t2m.io/api/v1/links?limit=1', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('T2M API error (401)');

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
      const responseBody = { short_url: 'https://t2m.io/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://t2m.io/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://t2m.io/api/v1/links', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('uses customDomain in request body when provided', async () => {
      const responseBody = { short_url: 'https://my.link/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };

      await adapter.createShortLink(ctx, 'https://example.com/long-url');

      const callArgs = (safeFetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.domain).toBe('my.link');

      fetchSpy.mockRestore();
    });

    it('throws on API error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('T2M create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { url: 'https://example.com/original' }));

      const result = await adapter.expandShortLink(mockContext, 'https://t2m.io/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith('https://t2m.io/api/v1/links/expand', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://t2m.io/abc123'))
        .rejects.toThrow('T2M expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { url: 'https://example.com/1', clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { destination: 'https://example.com/2', click_count: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://t2m.io/a', 'https://t2m.io/b']);
      expect(result).toEqual([
        { short: 'https://t2m.io/a', original: 'https://example.com/1', clicks: '42' },
        { short: 'https://t2m.io/b', original: 'https://example.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://t2m.io/a']);
      expect(result).toEqual([{ short: 'https://t2m.io/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('returns empty results on non-ok response (skips without error)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      const result = await adapter.linkStatistics(mockContext, ['https://t2m.io/a']);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = {
        links: [
          { short_url: 'https://t2m.io/a', url: 'https://example.com/1', clicks: 10 },
          { short_url: 'https://t2m.io/b', url: 'https://example.com/2', clicks: 20 },
        ],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://t2m.io/a', original: 'https://example.com/1', clicks: '10' },
        { short: 'https://t2m.io/b', original: 'https://example.com/2', clicks: '20' },
      ]);

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('T2M list failed (500)');

      fetchSpy.mockRestore();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      await adapter.validateCredentials(mockContext);

      expect(safeFetch).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
