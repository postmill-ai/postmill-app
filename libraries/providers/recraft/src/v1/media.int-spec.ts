import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
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
