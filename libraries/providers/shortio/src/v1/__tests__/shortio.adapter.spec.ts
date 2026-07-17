import { describe, it, expect, vi, beforeEach } from 'vitest';


import { ShortioAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { secretKey: 'sk_test123', domain: 'myshort.io' },
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

describe('ShortioAdapter', () => {
  let adapter: ShortioAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ShortioAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "shortio"', () => {
      expect(adapter.identifier).toBe('shortio');
    });

    it('has name "Short.io"', () => {
      expect(adapter.name).toBe('Short.io');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "short.io"', () => {
      expect(adapter.defaultDomain).toBe('short.io');
    });

    it('has credentialFields with secretKey and domain', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('secretKey');
      expect(keys).toContain('domain');
      const secretKeyField = adapter.credentialFields.find((f) => f.key === 'secretKey');
      expect(secretKeyField?.required).toBe(true);
      expect(secretKeyField?.type).toBe('password');
      const domainField = adapter.credentialFields.find((f) => f.key === 'domain');
      expect(domainField?.required).toBe(true);
      expect(domainField?.type).toBe('string');
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

    it('returns credentials.domain when no customDomain', () => {
      expect(adapter.resolveDomain(mockContext)).toBe('myshort.io');
    });

    it('returns defaultDomain when no customDomain and no credentials.domain', () => {
      const ctx: ShortLinkContext = { orgId: 'org-1', credentials: { secretKey: 'sk_test123' } };
      expect(adapter.resolveDomain(ctx)).toBe('short.io');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.short.io/api/links', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'sk_test123' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Short.io API error (401)');

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
      const responseBody = { idString: 'abc123', shortURL: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://myshort.io/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://api.short.io/api/links', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('honors the configured customDomain when building the short URL', async () => {
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'go.acme.dev' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { idString: 'abc123' }));

      const result = await adapter.createShortLink(ctx, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://go.acme.dev/abc123');
      // The customDomain is also sent to the API in the request body.
      const [, init] = safeFetch.mock.calls.find(([u]: [string]) => u.endsWith('/api/links')) as any;
      expect(JSON.parse(init.body).domain).toBe('go.acme.dev');

      fetchSpy.mockRestore();
    });

    it('prefers the API canonical full shortURL when present (speculative)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { idString: 'abc123', shortURL: 'https://myshort.io/canon' })
      );

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://myshort.io/canon');

      fetchSpy.mockRestore();
    });

    it('throws on API error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Short.io create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { originalURL: 'https://example.com/original' }));

      const result = await adapter.expandShortLink(mockContext, 'https://myshort.io/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith('https://api.short.io/api/links/expand', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://myshort.io/abc123'))
        .rejects.toThrow('Short.io expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { domain: 'myshort.io', idString: 'abc', originalURL: 'https://example.com/1', clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { domain: 'myshort.io', idString: 'def', originalURL: 'https://example.com/2', clicks: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://myshort.io/abc', 'https://myshort.io/def']);
      expect(result).toEqual([
        { short: 'https://myshort.io/abc', original: 'https://example.com/1', clicks: '42' },
        { short: 'https://myshort.io/def', original: 'https://example.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://myshort.io/a']);
      expect(result).toEqual([{ short: 'https://myshort.io/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('pushes a 0-click fallback on non-ok response (one entry per input)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      const result = await adapter.linkStatistics(mockContext, ['https://myshort.io/a', 'https://myshort.io/b']);
      expect(result).toEqual([
        { short: 'https://myshort.io/a', original: '', clicks: '0' },
        { short: 'https://myshort.io/b', original: '', clicks: '0' },
      ]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = [
        { domain: 'myshort.io', idString: 'a', originalURL: 'https://example.com/1', clicks: 10 },
        { domain: 'myshort.io', idString: 'b', originalURL: 'https://example.com/2', clicks: 20 },
      ];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://myshort.io/a', original: 'https://example.com/1', clicks: '10' },
        { short: 'https://myshort.io/b', original: 'https://example.com/2', clicks: '20' },
      ]);

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('Short.io list failed (500)');

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
