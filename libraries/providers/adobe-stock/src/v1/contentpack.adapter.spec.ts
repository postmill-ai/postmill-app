import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdobeStockContentPack } from './contentpack.adapter';

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

describe('AdobeStockContentPack', () => {
  const pack = new AdobeStockContentPack('adobe-key', (url: string | URL | Request, init?: RequestInit) =>
    mockFetch(url, init)
  );

  it('sends x-api-key + content_type filter and reads nb_results/files', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        nb_results: 1,
        files: [{ id: 42, title: 'Cat', thumbnail_500_url: 'https://a/c.jpg', comp_url: 'https://a/comp.jpg', creator_name: 'Jo' }],
      })
    );
    const res = await pack.search('photos', 'cat', 1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('stock.adobe.io/Rest/Media/1/Search/Files');
    expect(decodeURIComponent(url)).toContain('content_type:photo');
    expect((init.headers as any)['x-api-key']).toBe('adobe-key');
    expect(res.source).toBe('adobe-stock');
    expect(res.results[0]).toMatchObject({ id: '42', url: 'https://a/c.jpg', author: 'Jo' });
  });

  it('vectors use the illustration content type', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ nb_results: 0, files: [] }));
    await pack.search('vectors', 'logo', 1);
    expect(decodeURIComponent(mockFetch.mock.calls[0][0])).toContain('content_type:illustration');
  });
});
