import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { fireworksMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Fireworks image generation is
// synchronous: a single POST to the workflow text_to_image endpoint with
// `Accept: application/json` returns `{ base64: [...] }`, which the adapter wraps as data: URLs.

describe('fireworks media adapter (synchronous image)', () => {
  it('POSTs to /{model}/text_to_image with Bearer + Accept json, routes prompt/input into the body, and wraps base64 as a data URL', async () => {
    const { recs, ctx } = makeCtx(() => res({ base64: ['iVBORimage'] }));
    const adapter: any = fireworksMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a red fox logo', {
      apiKey: 'fw-key',
      model: 'flux-1-schnell-fp8',
      input: { width: 1024, height: 768, ignored: '' },
    });

    const r = recs[0];
    expect(r.url).toBe(
      'https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/flux-1-schnell-fp8/text_to_image',
    );
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer fw-key');
    expect(r.headers.Accept).toBe('application/json');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a red fox logo');
    expect(body.width).toBe(1024);
    expect(body.height).toBe(768);
    // empty-string input values are filtered out of the body.
    expect('ignored' in body).toBe(false);

    expect(out.image).toBe('data:image/png;base64,iVBORimage');
    expect(out.images).toEqual(['data:image/png;base64,iVBORimage']);
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = fireworksMediaModule.create(ctx as any);
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
});
