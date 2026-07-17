import { describe, it, expect, vi, beforeEach } from 'vitest';


import { RebrandlyAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext, ShortLinkStat } from '@gitroom/provider-kernel';

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

describe('RebrandlyAdapter', () => {
  let adapter: RebrandlyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RebrandlyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "rebrandly"', () => {
      expect(adapter.identifier).toBe('rebrandly');
    });

    it('has name "Rebrandly"', () => {
      expect(adapter.name).toBe('Rebrandly');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "rebrand.ly"', () => {
      expect(adapter.defaultDomain).toBe('rebrand.ly');
    });

    it('has credentialFields with apiKey and workspace', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('apiKey');
      expect(keys).toContain('workspace');
      const apiKeyField = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKeyField?.required).toBe(true);
      expect(apiKeyField?.type).toBe('password');
      const workspaceField = adapter.credentialFields.find((f) => f.key === 'workspace');
      expect(workspaceField?.required).toBe(false);
      expect(workspaceField?.type).toBe('string');
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
      expect(adapter.resolveDomain(mockContext)).toBe('rebrand.ly');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.rebrandly.com/v1/account', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ apikey: 'test-api-key' }),
      }));

      fetchSpy.mockRestore();
    });

    it('sends workspace header when provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));
      const ctx: ShortLinkContext = { ...mockContext, credentials: { apiKey: 'test-api-key', workspace: 'ws-123' } };

      const result = await adapter.validateCredentials(ctx);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api.rebrandly.com/v1/account', expect.objectContaining({
        headers: expect.objectContaining({ workspace: 'ws-123' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Rebrandly API error (401)');

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
      const responseBody = { shortUrl: 'https://rebrand.ly/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://rebrand.ly/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://api.rebrandly.com/v1/links', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('uses customDomain in request body when provided', async () => {
      const responseBody = { shortUrl: 'https://my.link/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };

      const result = await adapter.createShortLink(ctx, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://my.link/abc123');

      const callArgs = (safeFetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.domain).toEqual({ fullName: 'my.link' });

      fetchSpy.mockRestore();
    });

    it('throws on API error response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Rebrandly create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, [{ destination: 'https://example.com/original' }]),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://rebrand.ly/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('/links?slashtag=abc123'),
        expect.objectContaining({ method: 'GET' }),
      );

      fetchSpy.mockRestore();
    });

    it('returns empty string when destination field is absent', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, [{ id: 'x' }]),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://rebrand.ly/abc123');
      expect(result).toBe('');

      fetchSpy.mockRestore();
    });

    it('throws when link is not found (empty array)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, []),
      );

      await expect(adapter.expandShortLink(mockContext, 'https://rebrand.ly/abc123'))
        .rejects.toThrow('Rebrandly: link not found');

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://rebrand.ly/abc123'))
        .rejects.toThrow('Rebrandly expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, [{ destination: 'https://orig.com/1', clicks: 42 }]))
        .mockResolvedValueOnce(mockResponse(200, [{ destination: 'https://orig.com/2', clicks: 7 }]));

      const result = await adapter.linkStatistics(mockContext, ['https://rebrand.ly/a', 'https://rebrand.ly/b']);
      expect(result).toEqual([
        { short: 'https://rebrand.ly/a', original: 'https://orig.com/1', clicks: '42' },
        { short: 'https://rebrand.ly/b', original: 'https://orig.com/2', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://rebrand.ly/a']);
      expect(result).toEqual([{ short: 'https://rebrand.ly/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('skips links that return non-ok response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      const result = await adapter.linkStatistics(mockContext, ['https://rebrand.ly/a']);
      expect(result).toEqual([]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = [
        { shortUrl: 'https://rebrand.ly/a', destination: 'https://example.com/1', clicks: 5 },
        { shortUrl: 'https://rebrand.ly/b', destination: 'https://example.com/2', clicks: 3 },
      ];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://rebrand.ly/a', original: 'https://example.com/1', clicks: '5' },
        { short: 'https://rebrand.ly/b', original: 'https://example.com/2', clicks: '3' },
      ]);

      fetchSpy.mockRestore();
    });

    it('uses correct pagination params for page > 1', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, []));

      await adapter.listLinks(mockContext, 3);
      expect(safeFetch).toHaveBeenCalledWith(
        expect.stringContaining('skip=100'),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('Rebrandly list failed (500)');

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
