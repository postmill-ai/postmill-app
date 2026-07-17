import { describe, it, expect, vi, beforeEach } from 'vitest';


import { TinyccAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { login: 'myuser', apiKey: 'test-api-key' },
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

describe('TinyccAdapter', () => {
  let adapter: TinyccAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TinyccAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "tinycc"', () => {
      expect(adapter.identifier).toBe('tinycc');
    });

    it('has name "Tiny.cc"', () => {
      expect(adapter.name).toBe('Tiny.cc');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "tiny.cc"', () => {
      expect(adapter.defaultDomain).toBe('tiny.cc');
    });

    it('has credentialFields with login and apiKey', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('login');
      expect(keys).toContain('apiKey');
      const loginField = adapter.credentialFields.find((f) => f.key === 'login');
      expect(loginField?.required).toBe(true);
      expect(loginField?.type).toBe('string');
      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);
      expect(apiKeyField?.type).toBe('password');
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
      expect(adapter.resolveDomain(mockContext)).toBe('tiny.cc');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true when API returns error code "0"', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { error: { code: '0', msg: 'ok' } })
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('tiny.cc/api/shorten?login=myuser&apiKey=test-api-key'),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('returns ok: false when API returns error code other than "0"', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { error: { code: '100', msg: 'Invalid login' } })
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Tiny.cc error: Invalid login');

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
      const responseBody = { error: { code: '0' }, shortUrl: 'https://tiny.cc/abc123', hash: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://tiny.cc/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('tiny.cc/api/shorten?login=myuser&apiKey=test-api-key&url='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('throws when API returns non-zero error code', async () => {
      const responseBody = { error: { code: '100', msg: 'Invalid URL' } };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      await expect(adapter.createShortLink(mockContext, 'not-a-url'))
        .rejects.toThrow('Tiny.cc create failed: Invalid URL');

      fetchSpy.mockRestore();
    });

    it('throws on HTTP error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Tiny.cc create failed (500)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { error: { code: '0' }, url: 'https://example.com/original' })
      );

      const result = await adapter.expandShortLink(mockContext, 'https://tiny.cc/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('tiny.cc/api/expand?login=myuser&apiKey=test-api-key&short='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('throws when API returns non-zero error code', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { error: { code: '200', msg: 'Not found' } })
      );

      await expect(adapter.expandShortLink(mockContext, 'https://tiny.cc/nonexistent'))
        .rejects.toThrow('Tiny.cc expand failed: Not found');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 HTTP response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://tiny.cc/abc123'))
        .rejects.toThrow('Tiny.cc expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { url: 'https://example.com/1', clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { long_url: 'https://example.com/2', link_clicks: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://tiny.cc/a', 'https://tiny.cc/b']);
      expect(result).toEqual([
        { short: 'https://tiny.cc/a', original: 'https://example.com/1', clicks: '42' },
        { short: 'https://tiny.cc/b', original: 'https://example.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://tiny.cc/a']);
      expect(result).toEqual([{ short: 'https://tiny.cc/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('returns empty results on non-ok response (skips without error)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      const result = await adapter.linkStatistics(mockContext, ['https://tiny.cc/a']);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { error: { code: '0', msg: 'ok' } })
      );

      await adapter.validateCredentials(mockContext);

      expect(safeFetch).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
