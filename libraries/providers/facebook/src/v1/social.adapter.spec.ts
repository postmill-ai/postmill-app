import { describe, it, expect, beforeEach } from 'vitest';
import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { FacebookProvider } from './social.adapter';

const MAX_PAGE_DEPTH = 50;

function mockResponse(body: any, status = 200): any {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: ((): null => null) as any },
  } as any;
}

function setupPorts(
  handler: (url: string, init: any, callIndex: number) => any
) {
  let callIndex = 0;
  const undiciFetch = async (input: any, init: any = {}): Promise<any> => {
    const current = callIndex++;
    return handler(String(input), init, current);
  };
  setSocialFetchPorts({
    getVpnDispatcher: ((): undefined => undefined) as any,
    ssrfSafeDispatcher: undefined,
    isSafePublicHttpsUrl: (async () => true) as any,
    undiciFetch: undiciFetch as any,
    RefreshTokenError: class extends Error {},
    BadBodyError: class extends Error {},
    timer: (async (): Promise<void> => undefined) as any,
    sharp: (() => ({
      metadata: async () => ({ width: 100, height: 100 }),
    })) as any,
    readOrFetch: (async () => Buffer.from('x')) as any,
    safeFetch: undiciFetch as any,
  } as any);
  return { undiciFetch };
}

describe('FacebookProvider pagination caps and fetch routing', () => {
  beforeEach(() => {
    // each test gets a fresh port setup inside the test body
  });

  it('pages() caps /me/accounts pagination at MAX_PAGE_DEPTH pages', async () => {
    const requests: string[] = [];
    setupPorts((url) => {
      requests.push(url);
      if (url.includes('/me/accounts')) {
        const pageNumber = requests.filter((u) => u.includes('/me/accounts')).length;
        return mockResponse({
          data: [{ id: `page-${pageNumber}`, name: `Page ${pageNumber}` }],
          paging: {
            next: 'https://graph.facebook.com/v20.0/me/accounts?after=more',
          },
        });
      }
      return mockResponse({ data: [], paging: {} });
    });

    const provider = new FacebookProvider();
    const pages = await provider.pages('token');

    const accountCalls = requests.filter((u) => u.includes('/me/accounts'));
    expect(accountCalls.length).toBe(MAX_PAGE_DEPTH);
    expect(pages.length).toBe(MAX_PAGE_DEPTH);
  });

  it('pages() caps /me/businesses pagination at MAX_PAGE_DEPTH pages', async () => {
    const requests: string[] = [];
    setupPorts((url) => {
      requests.push(url);
      if (url.includes('/me/businesses')) {
        const pageNumber = requests.filter((u) => u.includes('/me/businesses')).length;
        return mockResponse({
          data: [{ id: `biz-${pageNumber}`, name: `Business ${pageNumber}` }],
          paging: {
            next: 'https://graph.facebook.com/v20.0/me/businesses?after=more',
          },
        });
      }
      // owned_pages / client_pages return empty so the inner loop exits quickly
      return mockResponse({ data: [], paging: {} });
    });

    const provider = new FacebookProvider();
    await provider.pages('token');

    const businessCalls = requests.filter((u) => u.includes('/me/businesses'));
    expect(businessCalls.length).toBe(MAX_PAGE_DEPTH);
  });

  it('fetchPageInformation() caps /me/accounts pagination at MAX_PAGE_DEPTH pages when page is not found', async () => {
    const requests: string[] = [];
    setupPorts((url) => {
      requests.push(url);
      if (url.includes('/me/accounts')) {
        return mockResponse({
          data: [{ id: 'other-page', name: 'Other Page' }],
          paging: {
            next: 'https://graph.facebook.com/v20.0/me/accounts?after=more',
          },
        });
      }
      return mockResponse({ data: [], paging: {} });
    });

    const provider = new FacebookProvider();
    await expect(
      provider.fetchPageInformation('token', { page: 'missing-page' })
    ).rejects.toThrow('Page not found in your accounts');

    const accountCalls = requests.filter((u) => u.includes('/me/accounts'));
    expect(accountCalls.length).toBe(MAX_PAGE_DEPTH);
  });

  it('fetchPageInformation() caps /me/businesses pagination at MAX_PAGE_DEPTH pages', async () => {
    const requests: string[] = [];
    setupPorts((url) => {
      requests.push(url);
      if (url.includes('/me/businesses')) {
        const pageNumber = requests.filter((u) => u.includes('/me/businesses')).length;
        return mockResponse({
          data: [{ id: `biz-${pageNumber}`, name: `Business ${pageNumber}` }],
          paging: {
            next: 'https://graph.facebook.com/v20.0/me/businesses?after=more',
          },
        });
      }
      return mockResponse({ data: [], paging: {} });
    });

    const provider = new FacebookProvider();
    await expect(
      provider.fetchPageInformation('token', { page: 'missing-page' })
    ).rejects.toThrow('Page not found in your accounts');

    const businessCalls = requests.filter((u) => u.includes('/me/businesses'));
    expect(businessCalls.length).toBe(MAX_PAGE_DEPTH);
  });

  it('analytics() routes Graph API insights calls through this.fetch()', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    setupPorts((url, init) => {
      requests.push({ url, method: init.method || 'GET' });
      return mockResponse({
        data: [
          {
            name: 'page_impressions_unique',
            values: [{ value: 42, end_time: '2024-01-01T08:00:00+0000' }],
          },
        ],
      });
    });

    const provider = new FacebookProvider();
    const result = await provider.analytics('page-id', 'token', 7);

    const insightCall = requests.find((r) => r.url.includes('/insights'));
    expect(insightCall).toBeDefined();
    expect(insightCall!.url).toContain('graph.facebook.com');
    expect(insightCall!.url).toContain('/page-id/insights');
    expect(insightCall!.method).toBe('GET');
    expect(result.some((r) => r.label === 'Page Impressions')).toBe(true);
  });
});
