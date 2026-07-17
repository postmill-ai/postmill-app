import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { vecteezyContentPackModule } from './contentpack.adapter';

// Recorded-fixture integration test (plan B4) — no network. Vecteezy is a BYOK content pack:
// `search(capability, ...)` GETs /v1/resources with a Bearer key and parses the data/total_count
// shape; `resolveDownload(id, capability)` mints a licensed URL from /resources/{id}/download.
// The module's create reads ctx.credentials.apiKey, so we seed it on the recording ctx.
//
// UNVERIFIED vs live key: Vecteezy's content/download API is partner-gated; the /v1/resources
// search/download endpoints, the `content_type` query value, and the data/total_count response
// shape are modelled on the common stock-API pattern and must be confirmed against a live key.

function pack(handler: Parameters<typeof makeCtx>[0]) {
  const { recs, ctx } = makeCtx(handler);
  (ctx as any).credentials = { apiKey: 'vecteezy-key' };
  return { recs, adapter: vecteezyContentPackModule.create(ctx as any) as any };
}

const SEARCH_RESPONSE = {
  data: [
    {
      id: 99,
      title: 'Mountain',
      preview_url: 'https://cdn.vecteezy/preview.jpg',
      thumbnail_url: 'https://cdn.vecteezy/thumb.jpg',
      contributor: 'Ana',
      contributor_url: 'https://www.vecteezy.com/members/ana',
      page_url: 'https://www.vecteezy.com/photo/99',
      width: 1920,
      height: 1080,
    },
  ],
  total_count: 1,
};

describe('vecteezy content pack adapter', () => {
  it('searches photos at /v1/resources with the Bearer header and parses the data/total_count shape', async () => {
    const { recs, adapter } = pack(() => res(SEARCH_RESPONSE));

    const out = await adapter.search('photos', 'cat', 1);

    const r = recs[0];
    expect(r.url).toBe(
      'https://api.vecteezy.com/v1/resources?term=cat&content_type=photo&page=1&per_page=20'
    );
    expect(r.method).toBe('GET');
    expect(r.headers['Authorization']).toBe('Bearer vecteezy-key');
    expect(r.headers['Accept']).toBe('application/json');
    expect(out.source).toBe('vecteezy');
    expect(out.configured).toBe(true);
    expect(out.page).toBe(1);
    expect(out.totalPages).toBe(1);
    expect(out.results[0]).toMatchObject({
      id: '99',
      url: 'https://cdn.vecteezy/preview.jpg',
      thumbUrl: 'https://cdn.vecteezy/thumb.jpg',
      author: 'Ana',
      authorUrl: 'https://www.vecteezy.com/members/ana',
      sourceUrl: 'https://www.vecteezy.com/photo/99',
      width: 1920,
      height: 1080,
      source: 'vecteezy',
      license: 'vecteezy-byok',
    });
  });

  it('routes each capability to its content_type and merges filters into the query', async () => {
    const { recs, adapter } = pack(() => res({ data: [], total_count: 0 }));

    await adapter.search('vectors', 'arrow', 2, { orientation: 'horizontal' });
    expect(recs[0].url).toBe(
      'https://api.vecteezy.com/v1/resources?term=arrow&content_type=vector&page=2&per_page=20&orientation=horizontal'
    );

    await adapter.search('videos', 'intro', 1);
    expect(recs[1].url).toBe(
      'https://api.vecteezy.com/v1/resources?term=intro&content_type=video&page=1&per_page=20'
    );
  });

  it('resolveDownload mints the licensed URL from /resources/{id}/download', async () => {
    const { recs, adapter } = pack(() => res({ data: { url: 'https://cdn.vecteezy/full.jpg' } }));

    const url = await adapter.resolveDownload('99', 'photos');

    expect(recs[0].url).toBe('https://api.vecteezy.com/v1/resources/99/download');
    expect(recs[0].headers['Authorization']).toBe('Bearer vecteezy-key');
    expect(url).toBe('https://cdn.vecteezy/full.jpg');
  });

  it('maps a 429 to the daily-cap error', async () => {
    const { adapter } = pack(() => res({}, false, 429));
    await expect(adapter.search('photos', 'cat', 1)).rejects.toThrow(/Vecteezy rate limit/);
  });
});
