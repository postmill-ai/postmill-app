import { describe, it, expect, vi, beforeEach } from 'vitest';


import { VgdAdapter } from '../shortlink.adapter';
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

describe('VgdAdapter', () => {
  let adapter: VgdAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new VgdAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "vgd"', () => {
      expect(adapter.identifier).toBe('vgd');
    });

    it('has name "v.gd"', () => {
      expect(adapter.name).toBe('v.gd');
    });

    it('has authType "none"', () => {
      expect(adapter.authType).toBe('none');
    });

    it('has defaultDomain "v.gd"', () => {
      expect(adapter.defaultDomain).toBe('v.gd');
    });

    it('has no credentialFields', () => {
      expect(adapter.credentialFields).toEqual([]);
    });

    it('has capabilities with create and expand only', () => {
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
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };
      expect(adapter.resolveDomain(ctx)).toBe('my.link');
    });

    it('returns defaultDomain when no customDomain', () => {
      expect(adapter.resolveDomain(mockContext)).toBe('v.gd');
    });
  });

  describe('validateCredentials', () => {
    it('always returns ok: true (no-auth provider)', async () => {
      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
    });
  });

  describe('createShortLink', () => {
    it('creates short link and returns shortUrl', async () => {
      const responseBody = { shorturl: 'https://v.gd/abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://v.gd/abc123');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('v.gd/create.php?format=json&url='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('throws when API returns errorcode', async () => {
      const responseBody = { errorcode: 1, errormessage: 'Invalid URL' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      await expect(adapter.createShortLink(mockContext, 'not-a-url'))
        .rejects.toThrow('v.gd create failed: Invalid URL');

      fetchSpy.mockRestore();
    });

    it('throws on HTTP error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('v.gd create failed (500)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { url: 'https://example.com/original' })
      );

      const result = await adapter.expandShortLink(mockContext, 'https://v.gd/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('v.gd/forward.php?format=json&shorturl='),
        expect.objectContaining({ method: 'GET' })
      );

      fetchSpy.mockRestore();
    });

    it('throws when API returns errorcode', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { errorcode: 1, errormessage: 'Not found' })
      );

      await expect(adapter.expandShortLink(mockContext, 'https://v.gd/nonexistent'))
        .rejects.toThrow('v.gd expand failed: Not found');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 HTTP response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://v.gd/abc123'))
        .rejects.toThrow('v.gd expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { shorturl: 'https://v.gd/abc123' })
      );

      await adapter.createShortLink(mockContext, 'https://example.com');

      expect(safeFetch).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
