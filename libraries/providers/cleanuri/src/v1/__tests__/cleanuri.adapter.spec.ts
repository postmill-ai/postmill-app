import { describe, it, expect, vi, beforeEach } from 'vitest';


import { CleanuriAdapter } from '../shortlink.adapter';
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

describe('CleanuriAdapter', () => {
  let adapter: CleanuriAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CleanuriAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "cleanuri"', () => {
      expect(adapter.identifier).toBe('cleanuri');
    });

    it('has name "CleanURI"', () => {
      expect(adapter.name).toBe('CleanURI');
    });

    it('has authType "none"', () => {
      expect(adapter.authType).toBe('none');
    });

    it('has defaultDomain "cleanuri.com"', () => {
      expect(adapter.defaultDomain).toBe('cleanuri.com');
    });

    it('has empty credentialFields', () => {
      expect(adapter.credentialFields).toEqual([]);
    });

    it('has only create capability enabled', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: false,
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
      expect(adapter.resolveDomain(mockContext)).toBe('cleanuri.com');
    });
  });

  describe('validateCredentials', () => {
    it('always returns ok: true (no auth)', async () => {
      const result = await adapter.validateCredentials(mockContext);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('createShortLink', () => {
    it('creates short link and returns shortUrl from result_url', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { result_url: 'https://cleanuri.com/abc123' }),
      );

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://cleanuri.com/abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://cleanuri.com/api/v1/shorten', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to short_url when result_url is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { short_url: 'https://cleanuri.com/xyz' }),
      );

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://cleanuri.com/xyz');

      fetchSpy.mockRestore();
    });

    it('falls back to link when result_url and short_url are absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { link: 'https://cleanuri.com/link' }),
      );

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://cleanuri.com/link');

      fetchSpy.mockRestore();
    });

    it('throws on API error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(400, 'Bad Request', false),
      );

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('CleanURI create failed (400)');

      fetchSpy.mockRestore();
    });

    it('throws on API error object in response body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { error: 'Invalid URL' }),
      );

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('CleanURI create failed: Invalid URL');

      fetchSpy.mockRestore();
    });
  });

  describe('undefined optional methods', () => {
    it('does not have expandShortLink', () => {
      expect((adapter as any).expandShortLink).toBeUndefined();
    });

    it('does not have linkStatistics', () => {
      expect((adapter as any).linkStatistics).toBeUndefined();
    });

    it('does not have listLinks', () => {
      expect((adapter as any).listLinks).toBeUndefined();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { result_url: 'https://cleanuri.com/abc' }),
      );

      await adapter.createShortLink(mockContext, 'https://example.com');
      expect(safeFetch).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
