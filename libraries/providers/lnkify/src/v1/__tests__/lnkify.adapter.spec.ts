import { describe, it, expect, vi, beforeEach } from 'vitest';


import { LnkifyAdapter, lnkifyShortlinkModule } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { apiKey: 'lf_live_testkey' },
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

describe('LnkifyAdapter', () => {
  let adapter: LnkifyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LnkifyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "lnkify"', () => {
      expect(adapter.identifier).toBe('lnkify');
    });

    it('has name "Lnkify"', () => {
      expect(adapter.name).toBe('Lnkify');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "lnkify.io"', () => {
      expect(adapter.defaultDomain).toBe('lnkify.io');
    });

    it('has credentialFields with apiKey (required password) and baseUrl (optional)', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toEqual(['apiKey', 'baseUrl']);
      const apiKey = adapter.credentialFields.find((f) => f.key === 'apiKey');
      expect(apiKey?.required).toBe(true);
      expect(apiKey?.type).toBe('password');
      expect(apiKey?.placeholder).toBe('lf_live_…');
      const baseUrl = adapter.credentialFields.find((f) => f.key === 'baseUrl');
      expect(baseUrl?.required).toBe(false);
      expect(baseUrl?.type).toBe('string');
    });

    it('has create, expand, statistics, customDomain enabled; bulkStatistics disabled', () => {
      expect(adapter.capabilities).toEqual({
        create: true,
        expand: true,
        statistics: true,
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
      expect(adapter.resolveDomain(mockContext)).toBe('lnkify.io');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true when getUserInfo resolves with an id', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: { getUserInfo: { id: 'user-1' } } }),
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://lnkify.io/graphql', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'lf_live_testkey' }),
      }));
      const body = JSON.parse((safeFetch as any).mock.calls[0][1].body);
      expect(body.query).toContain('getUserInfo');

      fetchSpy.mockRestore();
    });

    it('returns ok: false with "Invalid API key" when the key runs anonymously', async () => {
      // Lnkify answers a bad key with HTTP 200 + data null + an auth error message.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: null, errors: [{ message: 'You need to be authenticated.' }] }),
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API key');

      fetchSpy.mockRestore();
    });

    it('returns ok: false with "Rate limited — retry later" on 429', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(429, { errors: [{ message: 'Too many requests. Please try again later.' }] }, false),
      );

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Rate limited — retry later');

      fetchSpy.mockRestore();
    });

    it('returns ok: false on other non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Lnkify API error (500)');

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
    it('creates a short link and resolves the provider link id via lnkifyConnection', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { data: { createLnkify: 'abc1234' } }))
        .mockResolvedValueOnce(mockResponse(200, {
          data: { lnkifyConnection: { items: [{ id: 'link-id-1', lnkify: 'abc1234' }] } },
        }));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://lnkify.io/abc1234');
      expect(result.providerLinkId).toBe('link-id-1');

      expect(safeFetch).toHaveBeenCalledTimes(2);
      const createCall = (safeFetch as any).mock.calls[0];
      expect(createCall[0]).toBe('https://lnkify.io/graphql');
      expect(createCall[1].headers['x-api-key']).toBe('lf_live_testkey');
      const createBody = JSON.parse(createCall[1].body);
      expect(createBody.query).toContain('createLnkify');
      expect(createBody.query).toContain('target: "https://example.com/long-url"');
      expect(createBody.query).toContain('enableTracking: true');

      const lookupBody = JSON.parse((safeFetch as any).mock.calls[1][1].body);
      expect(lookupBody.query).toContain('lnkifyConnection');
      expect(lookupBody.query).toContain('search: "abc1234"');

      fetchSpy.mockRestore();
    });

    it('builds the short URL from the custom domain when provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { data: { createLnkify: 'abc1234' } }))
        .mockResolvedValueOnce(mockResponse(200, { data: { lnkifyConnection: { items: [] } } }));
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };

      const result = await adapter.createShortLink(ctx, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://my.link/abc1234');
      expect(result.providerLinkId).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('omits providerLinkId when the follow-up lookup fails', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { data: { createLnkify: 'abc1234' } }))
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://lnkify.io/abc1234');
      expect(result.providerLinkId).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('posts to the baseUrl credential origin for self-hosted instances', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { data: { createLnkify: 'abc1234' } }))
        .mockResolvedValueOnce(mockResponse(200, { data: { lnkifyConnection: { items: [] } } }));
      const ctx: ShortLinkContext = {
        ...mockContext,
        credentials: { apiKey: 'lf_live_testkey', baseUrl: 'https://links.internal.example.com/' },
      };

      await adapter.createShortLink(ctx, 'https://example.com/long-url');
      expect((safeFetch as any).mock.calls[0][0]).toBe('https://links.internal.example.com/graphql');

      fetchSpy.mockRestore();
    });

    it('throws the server message on a GraphQL error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: null, errors: [{ message: 'Target URL is not valid.' }] }),
      );

      await expect(adapter.createShortLink(mockContext, 'not-a-url'))
        .rejects.toThrow('Target URL is not valid.');

      fetchSpy.mockRestore();
    });

    it('throws on a non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error'));

      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Lnkify API error (500)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the target URL for a default-domain short URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: { targetUrl: 'https://example.com/original' } }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://lnkify.io/abc1234');
      expect(result).toBe('https://example.com/original');

      const body = JSON.parse((safeFetch as any).mock.calls[0][1].body);
      expect(body.query).toContain('targetUrl(lnkify: "abc1234")');
      expect(body.query).not.toContain('hostname');

      fetchSpy.mockRestore();
    });

    it('passes hostname when the short URL is on a custom domain', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: { targetUrl: 'https://example.com/original' } }),
      );

      const result = await adapter.expandShortLink(mockContext, 'https://my.link/abc1234');
      expect(result).toBe('https://example.com/original');

      const body = JSON.parse((safeFetch as any).mock.calls[0][1].body);
      expect(body.query).toContain('lnkify: "abc1234"');
      expect(body.query).toContain('hostname: "my.link"');

      fetchSpy.mockRestore();
    });

    it('throws the server message on "Target not found"', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: null, errors: [{ message: 'Target not found' }] }),
      );

      await expect(adapter.expandShortLink(mockContext, 'https://lnkify.io/nope123'))
        .rejects.toThrow('Target not found');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('maps getLnkifyInfo hitCount to ShortLinkStat entries', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, {
          data: { getLnkifyInfo: { id: 'link-id-1', lnkify: 'abc1234', target: 'https://example.com/x', hitCount: 42 } },
        }),
      );

      const results = await adapter.linkStatistics(mockContext, ['link-id-1']);
      expect(results).toEqual([
        { short: 'https://lnkify.io/abc1234', original: 'https://example.com/x', clicks: '42' },
      ]);
      const body = JSON.parse((safeFetch as any).mock.calls[0][1].body);
      expect(body.query).toContain('getLnkifyInfo(id: "link-id-1")');

      fetchSpy.mockRestore();
    });

    it('keeps a zero-clicks entry for a failing id instead of failing the batch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, {
          data: { getLnkifyInfo: { id: 'link-id-1', lnkify: 'abc1234', target: 'https://example.com/x', hitCount: 7 } },
        }))
        .mockResolvedValueOnce(
          mockResponse(200, { data: null, errors: [{ message: 'You need to be authenticated.' }] }),
        );

      const results = await adapter.linkStatistics(mockContext, ['link-id-1', 'link-id-2']);
      expect(results).toEqual([
        { short: 'https://lnkify.io/abc1234', original: 'https://example.com/x', clicks: '7' },
        { short: 'link-id-2', original: '', clicks: '0' },
      ]);

      fetchSpy.mockRestore();
    });
  });

  describe('module manifest', () => {
    it('declares the shortlink v1 manifest with docsUrl', () => {
      expect(lnkifyShortlinkModule.manifest.domain).toBe('shortlink');
      expect(lnkifyShortlinkModule.manifest.providerId).toBe('lnkify');
      expect(lnkifyShortlinkModule.manifest.version).toBe('v1');
      expect(lnkifyShortlinkModule.manifest.status).toBe('active');
      expect(lnkifyShortlinkModule.manifest.docsUrl).toBe('https://docs.lnkify.io');
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(200, { data: { getUserInfo: { id: 'user-1' } } }),
      );

      await adapter.validateCredentials(mockContext);
      expect(safeFetch).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
