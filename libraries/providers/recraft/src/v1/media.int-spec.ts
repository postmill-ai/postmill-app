import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { recraftMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Recraft is synchronous: a single
// POST to /v1/images/generations returns hosted URLs, so there is no pollJob.

describe('recraft media adapter (synchronous image)', () => {
  it('POSTs to /v1/images/generations with Bearer auth, routes prompt/model/input into the body, and parses the hosted URL', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ data: [{ url: 'https://cdn.recraft/out.png', image_id: 'img-1' }] }),
    );
    const adapter: any = recraftMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a red fox logo', {
      apiKey: 'recraft-key',
      model: 'recraftv3',
      input: { style: 'vector_illustration', size: '1024x1024' },
    });

    const r = recs[0];
    expect(r.url).toBe('https://external.api.recraft.ai/v1/images/generations');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer recraft-key');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a red fox logo');
    expect(body.model).toBe('recraftv3');
    expect(body.style).toBe('vector_illustration');
    expect(body.size).toBe('1024x1024');
    expect(out.image).toBe('https://cdn.recraft/out.png');
    expect(out.images).toEqual(['https://cdn.recraft/out.png']);
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = recraftMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
  });
});

describe('recraft media adapter testConnection', () => {
  it('GETs /users/me with Bearer auth — 200 ok, 401 Invalid API key, 500 throws, missing key', async () => {
    const okCtx = makeCtx(() => res({ credits: 10 }));
    const a1: any = recraftMediaModule.create(okCtx.ctx as any);
    expect(await a1.testConnection({ apiKey: 'recraft-key' })).toEqual({ ok: true, message: 'Connection successful' });
    expect(okCtx.recs[0].url).toBe('https://external.api.recraft.ai/v1/users/me');
    expect(okCtx.recs[0].method).toBe('GET');
    expect(okCtx.recs[0].headers.Authorization).toBe('Bearer recraft-key');

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a2: any = recraftMediaModule.create(bad.ctx as any);
    expect(await a2.testConnection({ apiKey: 'wrong' })).toEqual({ ok: false, message: 'Invalid API key' });

    const err = makeCtx(() => res('boom', false, 500));
    const a3: any = recraftMediaModule.create(err.ctx as any);
    await expect(a3.testConnection({ apiKey: 'recraft-key' })).rejects.toThrow(/connection test failed \(500\)/);

    const noKey = makeCtx(() => res({}));
    const a4: any = recraftMediaModule.create(noKey.ctx as any);
    expect(await a4.testConnection({})).toEqual({ ok: false, message: 'Recraft API key is required' });
    expect(noKey.recs).toHaveLength(0);
  });
});
