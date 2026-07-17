import { describe, it, expect, vi, beforeEach } from 'vitest';


import { TinyurlAdapter } from '../shortlink.adapter';
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

describe('TinyurlAdapter', () => {
  let adapter: TinyurlAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TinyurlAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "tinyurl"', () => {
      expect(adapter.identifier).toBe('tinyurl');
    });

    it('has name "TinyURL"', () => {
      expect(adapter.name).toBe('TinyURL');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "tinyurl.com"', () => {
      expect(adapter.defaultDomain).toBe('tinyurl.com');
    });

    it('has credentialFields with apiToken', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiToken');
      const field = adapter.credentialFields.find((f) => f.key === 'apiToken');
      expect(field?.required).toBe(true);
      expect(field?.type).toBe('password');
    });

    it('has create, expand, customDomain capabilities enabled; statistics disabled', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: true,
        statistics: false,
        bulkStatistics: false,
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
      expect(adapter.resolveDomain(mockContext)).toBe('tinyurl.com');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.tinyurl.com/create', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false with "Invalid API token" on 401', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API token');

      fetchSpy.mockRestore();
    });

    it('returns ok: false with "Invalid API token" on 403', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(403, 'Forbidden'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API token');

      fetchSpy.mockRestore();
    });

    it('returns ok: false on other non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('TinyURL API error (500)');

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
      const responseBody = { data: { tiny_url: 'https://tinyurl.com/abc123', id: 'abc123' } };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://tinyurl.com/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://api.tinyurl.com/create', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to url field when tiny_url is absent', async () => {
      const responseBody = { data: { url: 'https://tinyurl.com/fallback', alias: 'fb' } };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://tinyurl.com/fallback');
      expect(result.providerLinkId).toBe('fb');

      fetchSpy.mockRestore();
    });

    it('includes domain in request body when customDomain is provided', async () => {
      const responseBody = { data: { tiny_url: 'https://my.link/abc' } };
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
        .rejects.toThrow('TinyURL create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: { long_url: 'https://example.com/original' } }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://tinyurl.com/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith('https://api.tinyurl.com/expand', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to url field when long_url is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: { url: 'https://example.com/alt' } }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://tinyurl.com/abc123');
      expect(result).toBe('https://example.com/alt');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://tinyurl.com/abc123'))
        .rejects.toThrow('TinyURL expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('undefined optional methods', () => {
    it('does not have linkStatistics (capabilities say false)', () => {
      expect((adapter as any).linkStatistics).toBeUndefined();
    });

    it('does not have listLinks', () => {
      expect((adapter as any).listLinks).toBeUndefined();
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
