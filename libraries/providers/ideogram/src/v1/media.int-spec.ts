import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { ideogramMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Ideogram is synchronous: a single
// POST to /v1/ideogram-v3/generate returns hosted image URLs, so there is no pollJob. The
// request body is multipart/form-data (a FormData object, no Content-Type set so fetch picks
// the boundary), which the recording stub can't reliably introspect — so we assert the
// endpoint, method, and the distinctive `Api-Key` header (NOT Bearer), plus the parsed response.

describe('ideogram media adapter (synchronous image, multipart)', () => {
  it('POSTs to the v3 generate endpoint with the Api-Key header and parses hosted URLs', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ data: [{ url: 'https://cdn.ideogram/out.png' }] }),
    );
    const adapter: any = ideogramMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a neon sign reading HELLO', {
      apiKey: 'ideo-key',
      input: { aspect_ratio: '16x9', rendering_speed: 'TURBO' },
    });

    const r = recs[0];
    expect(r.url).toBe('https://api.ideogram.ai/v1/ideogram-v3/generate');
    expect(r.method).toBe('POST');
    // The key rides as Api-Key, not Authorization: Bearer.
    expect(r.headers['Api-Key']).toBe('ideo-key');
    expect(r.headers.Authorization).toBeUndefined();
    // Body is a FormData (multipart) — not JSON-introspectable; assert it was passed.
    expect(r.body).toBeInstanceOf(FormData);

    expect(out.image).toBe('https://cdn.ideogram/out.png');
    expect(out.images).toEqual(['https://cdn.ideogram/out.png']);
    expect(out.multi).toBe(false);
  });

  it('flags multi when several images come back', async () => {
    const { ctx } = makeCtx(() =>
      res({ data: [{ url: 'https://cdn.ideogram/a.png' }, { url: 'https://cdn.ideogram/b.png' }] }),
    );
    const adapter: any = ideogramMediaModule.create(ctx as any);
    const out = await adapter.generateImage('two cats', { apiKey: 'ideo-key' });
    expect(out.multi).toBe(true);
    expect(out.images).toHaveLength(2);
  });

  it('throws when the response carries no images', async () => {
    const { ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = ideogramMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', { apiKey: 'ideo-key' })).rejects.toThrow(
      'Ideogram returned no images',
    );
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = ideogramMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support video',
    );
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support audio',
    );
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support avatar',
    );
  });

  it('exposes an image-only capability manifest', () => {
    expect(ideogramMediaModule.manifest.providerId).toBe('ideogram');
    expect(ideogramMediaModule.manifest.capabilities.image).toBe(true);
    expect(ideogramMediaModule.manifest.capabilities.video).toBe(false);
  });
});

describe('ideogram media adapter testConnection', () => {
  it('GETs /v2/account/api-keys with the Api-Key header — 200 ok, 404 ok (valid non-admin key), 401 Invalid API key, 500 throws, missing key', async () => {
    const okCtx = makeCtx(() => res({ api_keys: [] }));
    const a1: any = ideogramMediaModule.create(okCtx.ctx as any);
    expect(await a1.testConnection({ apiKey: 'ideogram-key' })).toEqual({ ok: true, message: 'Connection successful' });
    expect(okCtx.recs[0].url).toBe('https://api.ideogram.ai/v2/account/api-keys');
    expect(okCtx.recs[0].method).toBe('GET');
    expect(okCtx.recs[0].headers['Api-Key']).toBe('ideogram-key');

    // 404 is documented for a VALID key whose owner is not an org billing admin.
    const nonAdmin = makeCtx(() => res('no billing access', false, 404));
    const a2: any = ideogramMediaModule.create(nonAdmin.ctx as any);
    expect(await a2.testConnection({ apiKey: 'ideogram-key' })).toEqual({ ok: true, message: 'Connection successful' });

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a3: any = ideogramMediaModule.create(bad.ctx as any);
    expect(await a3.testConnection({ apiKey: 'wrong' })).toEqual({ ok: false, message: 'Invalid API key' });

    const err = makeCtx(() => res('boom', false, 500));
    const a4: any = ideogramMediaModule.create(err.ctx as any);
    await expect(a4.testConnection({ apiKey: 'ideogram-key' })).rejects.toThrow(/connection test failed \(500\)/);

    const noKey = makeCtx(() => res({}));
    const a5: any = ideogramMediaModule.create(noKey.ctx as any);
    expect(await a5.testConnection({})).toEqual({ ok: false, message: 'Ideogram API key is required' });
    expect(noKey.recs).toHaveLength(0);
  });
});
