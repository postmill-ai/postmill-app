import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvatoContentPack } from './contentpack.adapter';

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

describe('EnvatoContentPack', () => {
  const pack = new EnvatoContentPack('envato-token', (url: string | URL | Request, init?: RequestInit) =>
    mockFetch(url, init)
  );

  it('maps each capability to the right marketplace site', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_hits: 0, matches: [] }));
    await pack.search('audio', 'beat', 1);
    expect(mockFetch.mock.calls[0][0]).toContain('site=audiojungle.net');
    await pack.search('videos', 'intro', 1);
    expect(mockFetch.mock.calls[1][0]).toContain('site=videohive.net');
  });

  it('sends a Bearer token and maps matches', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        total_hits: 1,
        matches: [{ id: 9, name: 'Logo', previews: { landscape_preview: { landscape_url: 'https://e/l.jpg' } }, author_username: 'amy' }],
      })
    );
    const res = await pack.search('photos', 'logo', 1);
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as any).Authorization).toBe('Bearer envato-token');
    expect(res.results[0]).toMatchObject({ id: '9', url: 'https://e/l.jpg', source: 'envato' });
  });
});
