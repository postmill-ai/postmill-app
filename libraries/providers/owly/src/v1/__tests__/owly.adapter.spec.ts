import { describe, it, expect, vi, beforeEach } from 'vitest';


import { OwlyAdapter } from '../shortlink.adapter';
const safeFetch = vi.fn((url: string, options?: RequestInit) => fetch(url, options));
import type { ShortLinkContext } from '@gitroom/provider-kernel';

const mockContext: ShortLinkContext = {
  orgId: 'org-1',
  credentials: { hootsuiteToken: 'test-hootsuite-token' },
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

describe('OwlyAdapter', () => {
  let adapter: OwlyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OwlyAdapter(safeFetch);
  });

  describe('metadata', () => {
    it('has identifier "owly"', () => {
      expect(adapter.identifier).toBe('owly');
    });

    it('has name "Ow.ly"', () => {
      expect(adapter.name).toBe('Ow.ly');
    });

    it('has authType "apiKey"', () => {
      expect(adapter.authType).toBe('apiKey');
    });

    it('has defaultDomain "ow.ly"', () => {
      expect(adapter.defaultDomain).toBe('ow.ly');
    });

    it('has credentialFields with hootsuiteToken', () => {
      const keys = adapter.credentialFields.map((f) => f.key);
      expect(keys).toContain('hootsuiteToken');
      const field = adapter.credentialFields.find((f) => f.key === 'hootsuiteToken');
      expect(field?.required).toBe(true);
      expect(field?.type).toBe('password');
    });

    it('has all capabilities disabled', () => {
      expect(adapter.capabilities).toEqual({
        create: false,
        expand: false,
        statistics: false,
        bulkStatistics: false,
        customDomain: false,
      });
    });

    it('has setupNotes', () => {
      expect(adapter.setupNotes).toBeDefined();
      expect(adapter.setupNotes).toContain('not supported via public API');
    });
  });

  describe('resolveDomain', () => {
    it('ignores customDomain and always returns defaultDomain', () => {
      const ctx: ShortLinkContext = { ...mockContext, customDomain: 'my.link' };
      expect(adapter.resolveDomain(ctx)).toBe('ow.ly');
    });

    it('returns defaultDomain without customDomain', () => {
      expect(adapter.resolveDomain(mockContext)).toBe('ow.ly');
    });
  });

  describe('validateCredentials', () => {
    it('returns ok: true on successful API response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(200, {}));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(true);
      expect(safeFetch).toHaveBeenCalledWith(
        'https://api.hootsuite.com/1/auth/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('returns ok: false on non-200 response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(401, 'Unauthorized'));

      const result = await adapter.validateCredentials(mockContext);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Ow.ly token validation failed (401)');

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
    it('throws because creation is not supported', async () => {
      await expect(adapter.createShortLink(mockContext, 'https://example.com'))
        .rejects.toThrow('Ow.ly short link creation is not supported via public API');
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
