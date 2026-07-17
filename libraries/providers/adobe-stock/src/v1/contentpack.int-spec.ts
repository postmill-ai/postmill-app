import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { adobestockContentPackModule } from './contentpack.adapter';

// Recorded-fixture integration test (plan B4) — no network. Adobe Stock is a BYOK content pack:
// `search(capability, ...)` GETs the Search/Files endpoint with the `x-api-key`/`x-product`
// headers and `search_parameters[...]` query bag, parsing the files/nb_results shape;
// `resolveDownload(id, cap)` re-queries Search/Files by media_id and returns the comp URL. The
// module's create reads ctx.credentials.apiKey, so we seed it on the recording ctx. Bracketed
// params are URL-encoded, so we assert via the parsed URLSearchParams rather than a raw string.
//
// UNVERIFIED vs live key: with an API key alone only the watermarked *comp* URL resolves — a full
// *licensed* asset needs an OAuth access token + entitlement (Rest/Libraries/1/Content/License).
// Confirm the result_columns set + comp_url field against a live entitlement.

function pack(handler: Parameters<typeof makeCtx>[0]) {
  const { recs, ctx } = makeCtx(handler);
  (ctx as any).credentials = { apiKey: 'adobe-key' };
  return { recs, adapter: adobestockContentPackModule.create(ctx as any) as any };
}

const SEARCH_RESPONSE = {
  files: [
    {
      id: 1234,
      title: 'Forest',
      width: 4000,
      height: 3000,
      thumbnail_500_url: 'https://cdn.adobe/thumb500.jpg',
      thumbnail_url: 'https://cdn.adobe/thumb.jpg',
      comp_url: 'https://cdn.adobe/comp.jpg',
      details_url: 'https://stock.adobe.com/1234',
      creator_name: 'Sam',
    },
  ],
  nb_results: 1,
};

describe('adobe-stock content pack adapter', () => {
  it('searches photos at Search/Files with the x-api-key header and search_parameters bag', async () => {
    const { recs, adapter } = pack(() => res(SEARCH_RESPONSE));

    const out = await adapter.search('photos', 'forest', 1);

    const r = recs[0];
    expect(r.method).toBe('GET');
    expect(r.headers['x-api-key']).toBe('adobe-key');
    expect(r.headers['x-product']).toBe('Postmill');
    expect(r.url.startsWith('https://stock.adobe.io/Rest/Media/1/Search/Files?')).toBe(true);

    const q = new URL(r.url).searchParams;
    expect(q.get('locale')).toBe('en_US');
    expect(q.get('search_parameters[words]')).toBe('forest');
    expect(q.get('search_parameters[limit]')).toBe('20');
    expect(q.get('search_parameters[offset]')).toBe('0');
    expect(q.get('search_parameters[filters][content_type:photo]')).toBe('1');
    expect(q.getAll('result_columns[]')).toContain('comp_url');
    expect(q.getAll('result_columns[]')).toContain('nb_results');

    expect(out.source).toBe('adobe-stock');
    expect(out.configured).toBe(true);
    expect(out.totalPages).toBe(1);
    expect(out.results[0]).toMatchObject({
      id: '1234',
      url: 'https://cdn.adobe/thumb500.jpg',
      author: 'Sam',
      sourceUrl: 'https://stock.adobe.com/1234',
      width: 4000,
      height: 3000,
      source: 'adobe-stock',
      license: 'adobe-stock-byok',
    });
  });

  it('paginates via offset and routes each capability to its content_type filter', async () => {
    const { recs, adapter } = pack(() => res({ files: [], nb_results: 0 }));

    await adapter.search('photos', 'x', 2);
    expect(new URL(recs[0].url).searchParams.get('search_parameters[offset]')).toBe('20');

    await adapter.search('vectors', 'y', 1);
    expect(
      new URL(recs[1].url).searchParams.get('search_parameters[filters][content_type:illustration]')
    ).toBe('1');

    await adapter.search('videos', 'z', 1);
    expect(
      new URL(recs[2].url).searchParams.get('search_parameters[filters][content_type:video]')
    ).toBe('1');
  });

  it('resolveDownload re-queries by media_id and returns the comp URL', async () => {
    const { recs, adapter } = pack(() =>
      res({ files: [{ id: 1234, comp_url: 'https://cdn.adobe/comp1234.jpg' }] })
    );

    const url = await adapter.resolveDownload('1234', 'photos');

    const q = new URL(recs[0].url).searchParams;
    expect(q.get('search_parameters[media_id]')).toBe('1234');
    expect(q.get('search_parameters[limit]')).toBe('1');
    expect(recs[0].headers['x-api-key']).toBe('adobe-key');
    expect(url).toBe('https://cdn.adobe/comp1234.jpg');
  });

  it('maps a 429 to the daily-cap error', async () => {
    const { adapter } = pack(() => res({}, false, 429));
    await expect(adapter.search('photos', 'forest', 1)).rejects.toThrow(/Adobe Stock rate limit/);
  });
});
