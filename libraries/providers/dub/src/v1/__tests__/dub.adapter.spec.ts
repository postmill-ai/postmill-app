import { describe, it, expect, vi, beforeEach } from 'vitest';


import { DubAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext, ShortLinkStat } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { token: 'test-token' },
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

describe('DubAdapter', () => {
  let adapter: DubAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DubAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "dub"', () => {
      expect(adapter.identifier).toBe('dub');
    });

    it('has name "Dub.co"', () => {
      expect(adapter.name).toBe('Dub.co');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "dub.sh"', () => {
      expect(adapter.defaultDomain).toBe('dub.sh');
    });

    it('has credentialFields with token and apiEndpoint', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('token');
      expect(keys).toContain('apiEndpoint');
      const tokenField = adapter.credentialFields.find((f) => f.key === 'token');
      expect(tokenField?.required).toBe(true);
      expect(tokenField?.type).toBe('password');
      const endpointField = adapter.credentialFields.find((f) => f.key === 'apiEndpoint');
      expect(endpointField?.required).toBe(false);
      expect(endpointField?.type).toBe('string');
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
      expect(adapter.resolveDomain(mockContext)).toBe('dub.sh');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.dub.co/links?page=1&pageSize=1', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }));

      fetchSpy.mockRestore();
    });

    it('uses custom apiEndpoint when provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));
      const ctx: ShortLinkContext = { ...mockContext, credentials: { token: 't', apiEndpoint: 'https://custom.api' } };

      const result = await adapter.validateCredentials(ctx);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://custom.api/links?page=1&pageSize=1', expect.any(Object));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Dub.co API error (401)');

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
      const responseBody = { shortLink: 'https://dub.sh/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://dub.sh/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://api.dub.co/links', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to url field when shortLink is absent', async () => {
      const responseBody = { url: 'https://dub.sh/fallback', id: 'fb456' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://dub.sh/fallback');
      expect(result.providerLinkId).toBe('fb456');

      fetchSpy.mockRestore();
    });

    it('uses customDomain in request body when provided', async () => {
      const responseBody = { shortLink: 'https://my.link/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };

      const result = await adapter.createShortLink(ctx, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://my.link/abc123');

      const callArgs = (safeFetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.domain).toBe('my.link');

      fetchSpy.mockRestore();
    });

    it('throws on API error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Dub.co create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { url: 'https://example.com/original' }));

      const result = await adapter.expandShortLink(mockContext, 'https://dub.sh/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('/links/info?url='),
        expect.objectContaining({ method: 'GET' }),
      );

      fetchSpy.mockRestore();
    });

    it('falls back to destinationUrl field', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { destinationUrl: 'https://example.com/dest' }));

      const result = await adapter.expandShortLink(mockContext, 'https://dub.sh/abc123');
      expect(result).toBe('https://example.com/dest');

      fetchSpy.mockRestore();
    });

    it('returns empty string when neither url nor destinationUrl present', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.expandShortLink(mockContext, 'https://dub.sh/abc123');
      expect(result).toBe('');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://dub.sh/abc123'))
        .rejects.toThrow('Dub.co expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { shortLink: 'https://dub.sh/a', url: 'https://orig.com/1', clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { shortLink: 'https://dub.sh/b', url: 'https://orig.com/2', clicks: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://dub.sh/a', 'https://dub.sh/b']);
      expect(result).toEqual([
        { short: 'https://dub.sh/a', original: 'https://orig.com/1', clicks: '42' },
        { short: 'https://dub.sh/b', original: 'https://orig.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://dub.sh/a']);
      expect(result).toEqual([{ short: 'https://dub.sh/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('pushes a 0-click fallback on non-ok response (one entry per input)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      const result = await adapter.linkStatistics(mockContext, ['https://dub.sh/a', 'https://dub.sh/b']);
      expect(result).toEqual([
        { short: 'https://dub.sh/a', original: '', clicks: '0' },
        { short: 'https://dub.sh/b', original: '', clicks: '0' },
      ]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = [
        { shortLink: 'https://dub.sh/a', url: 'https://example.com/1', clicks: 5 },
        { shortLink: 'https://dub.sh/b', url: 'https://example.com/2', clicks: 3 },
      ];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://dub.sh/a', original: 'https://example.com/1', clicks: '5' },
        { short: 'https://dub.sh/b', original: 'https://example.com/2', clicks: '3' },
      ]);

      fetchSpy.mockRestore();
    });

    it('handles wrapped response with links key', async () => {
      const responseBody = {
        links: [{ shortLink: 'https://dub.sh/x', url: 'https://example.com/x', clicks: 1 }],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 2);
      expect(result).toEqual([
        { short: 'https://dub.sh/x', original: 'https://example.com/x', clicks: '1' },
      ]);

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('Dub.co list failed (500)');

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
