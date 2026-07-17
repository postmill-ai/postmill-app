import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MagnificContentPack } from './contentpack.adapter';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('MagnificContentPack', () => {
  const pack = new MagnificContentPack('mag-key', (url: string | URL | Request, init?: RequestInit) =>
    mockFetch(url, init)
  );

  it('percent-encodes a traversal id instead of path-traversing the download URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { url: 'https://m/dl.jpg' } }));
    await pack.resolveDownload('../../admin', 'photos');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.magnific.com/v1/resources/..%2F..%2Fadmin/download');
    expect(url).not.toContain('/../');
  });

  it('encodes the id for every capability download path', async () => {
    for (const cap of ['icons', 'videos'] as const) {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: { url: 'https://m/dl' } }));
      await pack.resolveDownload('a/../b', cap);
      const [url] = mockFetch.mock.calls.at(-1)!;
      expect(url).toContain('a%2F..%2Fb');
      expect(url).not.toContain('a/../b');
    }
  });
});
