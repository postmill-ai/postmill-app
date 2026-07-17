import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { xaiMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. xAI image generation is the
// OpenAI-compatible synchronous POST /v1/images/generations (response `data[].url`), so there
// is no pollJob. The stub ctx.fetch records the request and returns a canned response.

describe('xai media adapter (synchronous OpenAI-compatible image)', () => {
  it('POSTs to /v1/images/generations with Bearer auth, sets model/prompt/response_format and routes input, then parses data[].url', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [{ url: 'https://cdn.xai/out.png' }] }));
    const adapter: any = xaiMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a red fox logo', {
      apiKey: 'xai-key',
      model: 'grok-2-image-1212',
      input: { n: 2 },
    });

    const r = recs[0];
    expect(r.url).toBe('https://api.x.ai/v1/images/generations');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer xai-key');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('grok-2-image-1212');
    expect(body.prompt).toBe('a red fox logo');
    expect(body.response_format).toBe('url');
    expect(body.n).toBe(2);

    expect(out.image).toBe('https://cdn.xai/out.png');
    expect(out.images).toEqual(['https://cdn.xai/out.png']);
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = xaiMediaModule.create(ctx as any);
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
