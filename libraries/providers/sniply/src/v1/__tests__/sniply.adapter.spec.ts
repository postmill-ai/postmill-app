import { describe, it, expect, vi, beforeEach } from 'vitest';


import { SniplyAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { apiToken: 'test-api-token' },
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

describe('SniplyAdapter', () => {
  let adapter: SniplyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SniplyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "sniply"', () => {
      expect(adapter.identifier).toBe('sniply');
    });

    it('has name "Sniply"', () => {
      expect(adapter.name).toBe('Sniply');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "snip.ly"', () => {
      expect(adapter.defaultDomain).toBe('snip.ly');
    });

    it('has credentialFields with apiToken', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiToken');
      const field = adapter.credentialFields.find((f) => f.key === 'apiToken');
      expect(field?.required).toBe(true);
      expect(field?.type).toBe('password');
    });

    it('has capabilities: create + customDomain, no expand/statistics', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: false,
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
      expect(adapter.resolveDomain(mockContext)).toBe('snip.ly');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.snip.ly/v1/account', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-token' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Sniply API error (401)');

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
      const responseBody = { short_url: 'https://snip.ly/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://snip.ly/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://api.snip.ly/v1/links', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('falls back to data.link and data.slug when short_url/id absent', async () => {
      const responseBody = { link: 'https://snip.ly/xyz', slug: 'xyz' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://snip.ly/xyz');
      expect(result.providerLinkId).toBe('xyz');

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
        .rejects.toThrow('Sniply create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('missing optional methods', () => {
    it('does not implement expandShortLink', () => {
      expect(adapter.expandShortLink).toBeUndefined();
    });

    it('does not implement linkStatistics', () => {
      expect(adapter.linkStatistics).toBeUndefined();
    });

    it('does not implement listLinks', () => {
      expect(adapter.listLinks).toBeUndefined();
    });

    it('does not implement oauth', () => {
      expect(adapter.oauth).toBeUndefined();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

      await adapter.validateCredentials(mockContext);

      expect(safeFetch).toHaveBeenCalled();
      expect(globalFetchSpy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });
});
