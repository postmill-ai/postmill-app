import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { envatoContentPackModule } from './contentpack.adapter';

// Recorded-fixture integration test (plan B4) — no network. Envato is a BYOK content pack:
// `search(capability, ...)` GETs the Market discovery search endpoint (one `site` per capability)
// with a Bearer personal token and parses the matches/total_hits shape; `resolveDownload(id, cap)`
// resolves the item via /v3/market/catalog/item and returns its best preview/audio URL (full
// licensed download is subscription/purchase gated). The module's create reads
// ctx.credentials.apiKey, so we seed it on the recording ctx.
//
// UNVERIFIED vs live key: the resolveDownload path returns the highest-quality *preview* URL —
// an Elements/Market *licensed* download has a different entitlement flow (Elements download or
// /v2/market/buyer/download). Confirm the preview field precedence + catalog item shape live.

function pack(handler: Parameters<typeof makeCtx>[0]) {
  const { recs, ctx } = makeCtx(handler);
  (ctx as any).credentials = { apiKey: 'envato-token' };
  return { recs, adapter: envatoContentPackModule.create(ctx as any) as any };
}

const SEARCH_RESPONSE = {
  matches: [
    {
      id: 7,
      name: 'Sunset Photo',
      author_username: 'jdoe',
      author_url: 'https://envato.com/u/jdoe',
      url: 'https://photodune.net/item/sunset/7',
      previews: { landscape_preview: { landscape_url: 'https://cdn.envato/preview7.jpg' } },
    },
  ],
  total_hits: 1,
};

describe('envato content pack adapter', () => {
  it('searches photos at the discovery endpoint with the Bearer header and parses matches/total_hits', async () => {
    const { recs, adapter } = pack(() => res(SEARCH_RESPONSE));

    const out = await adapter.search('photos', 'sunset', 1);

    const r = recs[0];
    expect(r.url).toBe(
      'https://api.envato.com/v1/discovery/search/search/item?term=sunset&site=photodune.net&page=1&page_size=20'
    );
    expect(r.method).toBe('GET');
    expect(r.headers['Authorization']).toBe('Bearer envato-token');
    expect(r.headers['Accept']).toBe('application/json');
    expect(out.source).toBe('envato');
    expect(out.configured).toBe(true);
    expect(out.totalPages).toBe(1);
    expect(out.results[0]).toMatchObject({
      id: '7',
      url: 'https://cdn.envato/preview7.jpg',
      author: 'jdoe',
      authorUrl: 'https://envato.com/u/jdoe',
      sourceUrl: 'https://photodune.net/item/sunset/7',
      source: 'envato',
      license: 'envato-byok',
    });
  });

  it('maps each capability to its marketplace site and adds the vectors category', async () => {
    const { recs, adapter } = pack(() => res({ matches: [], total_hits: 0 }));

    await adapter.search('videos', 'intro', 1);
    expect(recs[0].url).toBe(
      'https://api.envato.com/v1/discovery/search/search/item?term=intro&site=videohive.net&page=1&page_size=20'
    );

    await adapter.search('audio', 'beat', 1);
    expect(recs[1].url).toBe(
      'https://api.envato.com/v1/discovery/search/search/item?term=beat&site=audiojungle.net&page=1&page_size=20'
    );

    await adapter.search('vectors', 'icon', 2);
    expect(recs[2].url).toBe(
      'https://api.envato.com/v1/discovery/search/search/item?term=icon&site=graphicriver.net&page=2&page_size=20&category=vectors'
    );
  });

  it('resolveDownload resolves the catalog item and returns its preview URL', async () => {
    const { recs, adapter } = pack(() =>
      res({ id: 7, previews: { landscape_preview: { landscape_url: 'https://cdn.envato/full7.jpg' } } })
    );

    const url = await adapter.resolveDownload('7', 'photos');

    expect(recs[0].url).toBe('https://api.envato.com/v3/market/catalog/item?id=7');
    expect(recs[0].headers['Authorization']).toBe('Bearer envato-token');
    expect(url).toBe('https://cdn.envato/full7.jpg');
  });

  it('resolveDownload returns the audio preview mp3 for the audio capability', async () => {
    const { adapter } = pack(() =>
      res({ id: 9, previews: { audio_preview: { mp3_url: 'https://cdn.envato/beat9.mp3' } } })
    );

    const url = await adapter.resolveDownload('9', 'audio');
    expect(url).toBe('https://cdn.envato/beat9.mp3');
  });

  it('maps a 429 to the daily-cap error', async () => {
    const { adapter } = pack(() => res({}, false, 429));
    await expect(adapter.search('photos', 'sunset', 1)).rejects.toThrow(/Envato rate limit/);
  });
});
