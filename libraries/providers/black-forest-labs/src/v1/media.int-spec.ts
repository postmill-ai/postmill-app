import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { blackforestlabsMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. FLUX is submit + bounded internal
// poll: a POST to /v1/{model} returns a request id, then GET /v1/get_result?id= polls until
// status 'Ready', keeping the synchronous image contract. The stub ctx.fetch records each
// request and returns canned responses matching BFL's documented shape.

describe('black-forest-labs media adapter (bounded-poll synchronous image)', () => {
  it('POSTs to /v1/{model} with the x-key header, routes prompt + size-derived width/height + input, then polls get_result and parses result.sample', async () => {
    const { recs, ctx } = makeCtx((url, _init, n) =>
      url.includes('/get_result')
        ? res({ status: 'Ready', result: { sample: 'https://cdn.bfl/out.png', seed: 7 } })
        : res({ id: 'req-1' }),
    );
    const adapter: any = blackforestlabsMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a red fox logo', {
      apiKey: 'bfl-key',
      model: 'flux-pro-1.1',
      size: '512x768',
      input: { prompt_upsampling: true },
    });

    const submit = recs[0];
    expect(submit.url).toBe('https://api.bfl.ai/v1/flux-pro-1.1');
    expect(submit.method).toBe('POST');
    expect(submit.headers['x-key']).toBe('bfl-key');
    const body = JSON.parse(submit.body);
    expect(body.prompt).toBe('a red fox logo');
    expect(body.width).toBe(512);
    expect(body.height).toBe(768);
    expect(body.prompt_upsampling).toBe(true);

    // Second request is the bounded poll against get_result with the submitted id.
    expect(recs[1].url).toBe('https://api.bfl.ai/v1/get_result?id=req-1');
    expect(recs[1].headers['x-key']).toBe('bfl-key');

    expect(out.image).toBe('https://cdn.bfl/out.png');
    expect(out.images).toEqual(['https://cdn.bfl/out.png']);
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = blackforestlabsMediaModule.create(ctx as any);
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
