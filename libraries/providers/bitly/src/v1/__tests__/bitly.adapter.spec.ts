import { describe, it, expect, vi, beforeEach } from 'vitest';


import { BitlyAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext, ShortLinkStat } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { accessToken: 'test-token' },
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

describe('BitlyAdapter', () => {
  let adapter: BitlyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BitlyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "bitly"', () => {
      expect(adapter.identifier).toBe('bitly');
    });

    it('has name "Bitly"', () => {
      expect(adapter.name).toBe('Bitly');
    });

    it('has authType "oauth2"', () => {
      expect(adapter.authType).toBe('oauth2');
    });

    it('has defaultDomain "bit.ly"', () => {
      expect(adapter.defaultDomain).toBe('bit.ly');
    });

    it('has credentialFields with accessToken', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('accessToken');
      const field = adapter.credentialFields.find((f) => f.key === 'accessToken');
      expect(field?.required).toBe(true);
      expect(field?.type).toBe('password');
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
      expect(adapter.resolveDomain(mockContext)).toBe('bit.ly');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith('https://api-ssl.bitly.com/v4/user', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }));

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Bitly API error (401)');

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
      const responseBody = { link: 'https://bit.ly/abc123', id: 'abc123' };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.createShortLink(mockContext, 'https://example.com/long-url');
      expect(result.shortUrl).toBe('https://bit.ly/abc123');
      expect(result.providerLinkId).toBe('abc123');
      expect(safeFetch).toHaveBeenCalledWith('https://api-ssl.bitly.com/v4/shorten', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('uses customDomain in request body when provided', async () => {
      const responseBody = { link: 'https://my.link/abc123', id: 'abc123' };
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
        .rejects.toThrow('Bitly create failed (400)');

      fetchSpy.mockRestore();
    });
  });

  describe('expandShortLink', () => {
    it('returns the long URL from expand response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { long_url: 'https://example.com/original' }));

      const result = await adapter.expandShortLink(mockContext, 'https://bit.ly/abc123');
      expect(result).toBe('https://example.com/original');
      expect(safeFetch).toHaveBeenCalledWith('https://api-ssl.bitly.com/v4/expand', expect.objectContaining({
        method: 'POST',
      }));

      fetchSpy.mockRestore();
    });

    it('throws on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(404, 'Not Found', false));

      await expect(adapter.expandShortLink(mockContext, 'https://bit.ly/abc123'))
        .rejects.toThrow('Bitly expand failed (404)');

      fetchSpy.mockRestore();
    });
  });

  describe('linkStatistics', () => {
    it('returns click statistics for given links', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse(200, { total_clicks: 42 }))
        .mockResolvedValueOnce(mockResponse(200, { total_clicks: 7 }));

      const result = await adapter.linkStatistics(mockContext, ['https://bit.ly/a', 'https://bit.ly/b']);
      expect(result).toEqual([
        { short: 'https://bit.ly/a', original: '', clicks: '42' },
        { short: 'https://bit.ly/b', original: '', clicks: '7' },
      ]);

      fetchSpy.mockRestore();
    });

    it('returns zero clicks on fetch error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await adapter.linkStatistics(mockContext, ['https://bit.ly/a']);
      expect(result).toEqual([{ short: 'https://bit.ly/a', original: '', clicks: '0' }]);

      fetchSpy.mockRestore();
    });

    it('pushes a 0-click fallback on non-ok response (one entry per input)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      const result = await adapter.linkStatistics(mockContext, ['https://bit.ly/a', 'https://bit.ly/b']);
      expect(result).toEqual([
        { short: 'https://bit.ly/a', original: '', clicks: '0' },
        { short: 'https://bit.ly/b', original: '', clicks: '0' },
      ]);

      fetchSpy.mockRestore();
    });
  });

  describe('listLinks', () => {
    it('returns paginated links from API', async () => {
      const responseBody = {
        links: [
          { link: 'https://bit.ly/a', long_url: 'https://example.com/1' },
          { link: 'https://bit.ly/b', long_url: 'https://example.com/2' },
        ],
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, responseBody));

      const result = await adapter.listLinks(mockContext, 1);
      expect(result).toEqual([
        { short: 'https://bit.ly/a', original: 'https://example.com/1', clicks: '0' },
        { short: 'https://bit.ly/b', original: 'https://example.com/2', clicks: '0' },
      ]);

      fetchSpy.mockRestore();
    });

    it('throws on API error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(500, 'Server Error', false));

      await expect(adapter.listLinks(mockContext, 1))
        .rejects.toThrow('Bitly list failed (500)');

      fetchSpy.mockRestore();
    });
  });

  describe('oauth', () => {
    it('authorizeUrl includes client_id from extraConfig', () => {
      const ctx: ShortLinkContext = { ...mockContext, extraConfig: { clientId: 'my-client-id' } };
      const url = adapter.oauth!.authorizeUrl(ctx, 'state-123', 'https://app.com/callback');
      expect(url).toContain('https://bitly.com/oauth/authorize');
      expect(url).toContain('client_id=my-client-id');
      expect(url).toContain('state=state-123');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.com%2Fcallback');
      expect(url).toContain('response_type=code');
      expect(url).not.toContain('code_challenge');
    });

    it('authorizeUrl includes code_challenge and code_challenge_method=S256 when codeChallenge provided', () => {
      const ctx: ShortLinkContext = { ...mockContext, extraConfig: { clientId: 'cid' } };
      const url = adapter.oauth!.authorizeUrl(ctx, 's1', 'https://app.com/callback', 'abc123challenge');
      expect(url).toContain('code_challenge=abc123challenge');
      expect(url).toContain('code_challenge_method=S256');
    });

    it('exchangeCode returns accessToken on success', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { access_token: 'exchanged-token' }));
      const ctx: ShortLinkContext = { ...mockContext, extraConfig: { clientId: 'cid', clientSecret: 'csecret' } };

      const result = await adapter.oauth!.exchangeCode('auth-code', 'https://app.com/callback', ctx);
      expect(result).toEqual({ accessToken: 'exchanged-token' });

      fetchSpy.mockRestore();
    });

    it('exchangeCode throws on non-ok response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(400, 'Bad Request', false));
      const ctx: ShortLinkContext = { ...mockContext, extraConfig: { clientId: 'cid', clientSecret: 'csecret' } };

      await expect(adapter.oauth!.exchangeCode('auth-code', 'https://app.com/callback', ctx))
        .rejects.toThrow('Bitly OAuth token exchange failed');

      fetchSpy.mockRestore();
    });

    it('exchangeCode includes code_verifier in POST body when provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { access_token: 'tok' }));
      const ctx: ShortLinkContext = { ...mockContext, extraConfig: { clientId: 'cid', clientSecret: 'cs' } };

      await adapter.oauth!.exchangeCode('auth-code', 'https://app.com/callback', ctx, 'my-verifier');

      const callArgs = (safeFetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toMatchObject({
        client_id: 'cid',
        client_secret: 'cs',
        code: 'auth-code',
        redirect_uri: 'https://app.com/callback',
        code_verifier: 'my-verifier',
      });

      fetchSpy.mockRestore();
    });

    it('exchangeCode omits code_verifier when not provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, { access_token: 'tok' }));
      const ctx: ShortLinkContext = { ...mockContext, extraConfig: { clientId: 'cid', clientSecret: 'cs' } };

      await adapter.oauth!.exchangeCode('auth-code', 'https://app.com/callback', ctx);

      const callArgs = (safeFetch as any).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).not.toHaveProperty('code_verifier');

      fetchSpy.mockRestore();
    });
  });

  describe('safeFetch usage', () => {
    it('uses safeFetch (not bare fetch) for API calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch');

      await adapter.validateCredentials(mockContext);

      expect(safeFetch).toHaveBeenCalled();
      // safeFetch delegates to global fetch, so it should also be called
      expect(globalFetchSpy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });
});
