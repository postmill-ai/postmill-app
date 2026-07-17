import { describe, it, expect, vi, beforeEach } from 'vitest';


import { CuttlyAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

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

describe('CuttlyAdapter', () => {
  let adapter: CuttlyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CuttlyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "cuttly"', () => {
      expect(adapter.identifier).toBe('cuttly');
    });

    it('has name "Cutt.ly"', () => {
      expect(adapter.name).toBe('Cutt.ly');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "cutt.ly"', () => {
      expect(adapter.defaultDomain).toBe('cutt.ly');
    });

    it('has credentialFields with apiKey', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      const field = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(field?.required).toBe(true);
      expect(field?.type).toBe('password');
    });

    it('has capabilities with bulkStatistics and customDomain disabled', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: true,
        statistics: true,
        bulkStatistics: false,
        customDomain: false,
      });
    });
  });

  describe('resolveDomain', () => {
    it('returns customDomain when provided', () => {
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };
      expect(adapter.resolveDomain(ctx)).toBe('my.link');
    });

    it('returns defaultDomain when no customDomain', () => {
      expect(adapter.resolveDomain(mockContext)).toBe('cutt.ly');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true when API returns status 7', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: { status: 7, shortLink: 'https://cutt.ly/test' } })
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('cutt.ly/api/api.php?key=test-api-key&short='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('returns ok: false when API returns status 4 (invalid key)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: { status: 4 } })
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid Cutt.ly API key');

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 HTTP response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cutt.ly HTTP 500');

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
      const responseBody = { url: { status: 7, shortLink: 'https://cutt.ly/abc123', code: 'abc123' } };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://cutt.ly/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('cutt.ly/api/api.php?key=test-api-key&short='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('throws when Cutt.ly API returns non-7 status', async () => {
      const responseBody = { url: { status: 1, title: 'Invalid URL' } };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Cutt.ly create failed: Invalid URL');

      fetchSpy.mockRestore();
    });

    it('throws on HTTP error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Cutt.ly create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: { fullLink: 'https://example.com/original' } })
      );

      const result = await adapter.expandShortLink(mockContext, 'https://cutt.ly/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('cutt.ly/api/api.php?key=test-api-key&short='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://cutt.ly/abc123'))
        .rejects.toThrow('Cutt.ly expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { url: { fullLink: 'https://example.com/1', clicks: 42 } }))
        .mockResolvedValueOnce(mockResponse(200, { url: { fullLink: 'https://example.com/2', clicks: 7 } }));

      const result = await adapter.linkStatistics(mockContext, ['https://cutt.ly/a', 'https://cutt.ly/b']);
      expect(result).toEqual([
        { short: 'https://cutt.ly/a', original: 'https://example.com/1', clicks: '42' },
        { short: 'https://cutt.ly/b', original: 'https://example.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://cutt.ly/a']);
      expect(result).toEqual([{ short: 'https://cutt.ly/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('returns empty results on non-ok response (skips without error)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      const result = await adapter.linkStatistics(mockContext, ['https://cutt.ly/a']);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: { status: 7, shortLink: 'https://cutt.ly/test' } })
      );

      await adapter.validateCredentials(mockContext);

      expect(safeFetch).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
