import { describe, it, expect, vi, beforeEach } from 'vitest';


import { IsgdAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: {},
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

describe('IsgdAdapter', () => {
  let adapter: IsgdAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new IsgdAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "isgd"', () => {
      expect(adapter.identifier).toBe('isgd');
    });

    it('has name "is.gd"', () => {
      expect(adapter.name).toBe('is.gd');
    });

    it('has authType "none"', () => {
      expect(adapter.authType).toBe('none');
    });

    it('has defaultDomain "is.gd"', () => {
      expect(adapter.defaultDomain).toBe('is.gd');
    });

    it('has empty credentialFields', () => {
      expect(adapter.credentialFields).toEqual([]);
    });

    it('has create and expand capabilities, statistics disabled', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: true,
        statistics: false,
        bulkStatistics: false,
        customDomain: false,
      });
    });
  });

  describe('resolveDomain', () => {
    it('returns customDomain when provided', () => {
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'custom.link' };
      expect(adapter.resolveDomain(ctx)).toBe('custom.link');
    });

    it('returns defaultDomain when no customDomain', () => {
      expect(adapter.resolveDomain(mockContext)).toBe('is.gd');
    });
  });

  describe('validateCredentials', () => {
    it('always returns ok: true (no auth)', async () => {
      const result = await adapter.validateCredentials(mockContext);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('createShortLink', () => {
    it('creates short link and returns shortUrl from shorturl field', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { shorturl: 'https://is.gd/abc123' }),
      );

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://is.gd/abc123');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://is.gd/create.php'),
        expect.objectContaining({ method: 'GET' }),
      );

      fetchSpy.mockRestore();
    });

    it('falls back to url field when shorturl is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: 'https://is.gd/xyz' }),
      );

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://is.gd/xyz');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 HTTP response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(500, 'Server Error', false),
      );

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('is.gd create failed (500)');

      fetchSpy.mockRestore();
    });

    it('throws on errorcode in response body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { errorcode: 1, errormessage: 'Invalid URL' }),
      );

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('is.gd create failed: Invalid URL');

      fetchSpy.mockRestore();
    });

    it('throws on errorcode with fallback to error field', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { errorcode: 2, error: 'Bad request' }),
      );

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('is.gd create failed: Bad request');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the expanded URL from API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: 'https://example.com/original' }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://is.gd/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://is.gd/forward.php'),
        expect.objectContaining({ method: 'GET' }),
      );

      fetchSpy.mockRestore();
    });

    it('throws on non-200 HTTP response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(404, 'Not Found', false),
      );

      await expect(adapter.expandShortLink(mockContext, 'https://is.gd/abc123'))
        .rejects.toThrow('is.gd expand failed (404)');

      fetchSpy.mockRestore();
    });

    it('throws on errorcode from API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { errorcode: 3, errormessage: 'Link not found' }),
      );

      await expect(adapter.expandShortLink(mockContext, 'https://is.gd/abc123'))
        .rejects.toThrow('is.gd expand failed: Link not found');

      fetchSpy.mockRestore();
    });

    it('returns empty string when url field is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, {}),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://is.gd/abc123');
      expect(result).toBe('');

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
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { shorturl: 'https://is.gd/abc' }),
      );

      await adapter.createShortLink(mockContext, 'https://example.com');
      expect(safeFetch).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
