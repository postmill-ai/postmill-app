import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentPackDailyCapError } from '@gitroom/provider-kernel';
import { VecteezyContentPack } from './contentpack.adapter';

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

describe('VecteezyContentPack', () => {
  const pack = new VecteezyContentPack('vz-key', (url: string | URL | Request, init?: RequestInit) =>
    mockFetch(url, init)
  );

  it('searches the resources endpoint with a Bearer key and maps results', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 7, title: 'Sunset', preview_url: 'https://v/p.jpg' }], total_count: 1 })
    );
    const res = await pack.search('photos', 'sunset', 1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('https://api.vecteezy.com/v1/resources');
    expect(url).toContain('content_type=photo');
    expect((init.headers as any).Authorization).toBe('Bearer vz-key');
    expect(res.source).toBe('vecteezy');
    expect(res.results[0]).toMatchObject({ id: '7', url: 'https://v/p.jpg', source: 'vecteezy' });
  });

  it('maps a 429 to ContentPackDailyCapError', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
    await expect(pack.search('photos', 'x', 1)).rejects.toBeInstanceOf(ContentPackDailyCapError);
  });

  it('percent-encodes a traversal id instead of path-traversing the download URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { url: 'https://v/dl.jpg' } }));
    await pack.resolveDownload('../../admin', 'photos');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.vecteezy.com/v1/resources/..%2F..%2Fadmin/download');
    expect(url).not.toContain('/../');
  });
});
