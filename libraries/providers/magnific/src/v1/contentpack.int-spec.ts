import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { magnificContentPackModule } from './contentpack.adapter';

// Recorded-fixture integration test (plan B4) — no network. Magnific is a BYOK content pack:
// `search(capability, ...)` GETs the per-capability resources endpoint and parses the data/meta
// shape; `resolveDownload(id, capability)` mints a licensed URL. The module's create reads
// ctx.credentials.apiKey, so we seed it on the recording ctx.

function pack(handler: Parameters<typeof makeCtx>[0]) {
  const { recs, ctx } = makeCtx(handler);
  (ctx as any).credentials = { apiKey: 'magnific-key' };
  return { recs, adapter: magnificContentPackModule.create(ctx as any) as any };
}

const SEARCH_RESPONSE = {
  data: [
    {
      id: 42,
      title: 'Cat',
      url: 'https://www.magnific.com/p/42',
      image: { source: { url: 'https://cdn.magnific/preview.jpg', size: { width: 800, height: 600 } } },
      author: { name: 'Jo', slug: 'jo' },
    },
  ],
  meta: { total: 1, last_page: 1, per_page: 20 },
};

describe('magnific content pack adapter', () => {
  it('searches photos at /v1/resources with the api-key header and parses the data/meta shape', async () => {
    const { recs, adapter } = pack(() => res(SEARCH_RESPONSE));

    const out = await adapter.search('photos', 'cat', 1);

    const r = recs[0];
    expect(r.url).toBe('https://api.magnific.com/v1/resources?term=cat&page=1&limit=20');
    expect(r.method).toBe('GET');
    expect(r.headers['x-magnific-api-key']).toBe('magnific-key');
    expect(out.source).toBe('magnific');
    expect(out.configured).toBe(true);
    expect(out.page).toBe(1);
    expect(out.totalPages).toBe(1);
    expect(out.results[0]).toMatchObject({
      id: '42',
      url: 'https://cdn.magnific/preview.jpg',
      author: 'Jo',
      authorUrl: 'https://www.magnific.com/author/jo',
      sourceUrl: 'https://www.magnific.com/p/42',
      width: 800,
      height: 600,
      source: 'magnific',
      license: 'magnific-byok',
    });
  });

  it('routes each capability to its endpoint and merges filters into the query', async () => {
    const { recs, adapter } = pack(() => res({ data: [], meta: {} }));

    await adapter.search('icons', 'arrow', 2, { color: 'black' });
    expect(recs[0].url).toBe('https://api.magnific.com/v1/icons?term=arrow&page=2&limit=20&color=black');

    await adapter.search('videos', 'intro', 1);
    expect(recs[1].url).toBe('https://api.magnific.com/v1/videos?term=intro&page=1&limit=20');
  });

  it('resolveDownload mints the licensed URL from the per-capability download endpoint', async () => {
    const { recs, adapter } = pack(() => res({ data: { url: 'https://cdn.magnific/full.jpg' } }));

    const url = await adapter.resolveDownload('42', 'photos');

    expect(recs[0].url).toBe('https://api.magnific.com/v1/resources/42/download');
    expect(recs[0].headers['x-magnific-api-key']).toBe('magnific-key');
    expect(url).toBe('https://cdn.magnific/full.jpg');
  });

  it('maps a 429 to the daily-cap error', async () => {
    const { adapter } = pack(() => res({}, false, 429));
    await expect(adapter.search('photos', 'cat', 1)).rejects.toThrow(/Magnific limit/);
  });
});
