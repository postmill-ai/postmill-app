import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { openrouterMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. OpenRouter media is image-only and
// synchronous: a single POST to /api/v1/images returns `data[].b64_json` (or `data[].url`), so
// there is no pollJob.

describe('openrouter media adapter (synchronous image)', () => {
  it('POSTs to /api/v1/images with Bearer auth and a {model,prompt,...input} JSON body, wrapping b64_json into a data URL', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ data: [{ b64_json: 'QUJD' }] }),
    );
    const adapter: any = openrouterMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a mountain at dawn', {
      apiKey: 'or-key',
      model: 'google/gemini-2.5-flash-image',
      input: { quality: 'high', size: '1024x1024' },
    });

    const r = recs[0];
    expect(r.url).toBe('https://openrouter.ai/api/v1/images');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer or-key');
    expect(r.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('google/gemini-2.5-flash-image');
    expect(body.prompt).toBe('a mountain at dawn');
    expect(body.quality).toBe('high');
    expect(body.size).toBe('1024x1024');

    expect(out.image).toBe('data:image/png;base64,QUJD');
    expect(out.images).toEqual(['data:image/png;base64,QUJD']);
    expect(out.multi).toBe(false);
  });

  it('passes through a hosted url when the response gives one', async () => {
    const { ctx } = makeCtx(() => res({ data: [{ url: 'https://cdn.or/out.png' }] }));
    const adapter: any = openrouterMediaModule.create(ctx as any);
    const out = await adapter.generateImage('x', { apiKey: 'or-key', model: 'm' });
    expect(out.image).toBe('https://cdn.or/out.png');
  });

  it('throws when the response carries no image', async () => {
    const { ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = openrouterMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', { apiKey: 'or-key', model: 'm' })).rejects.toThrow(
      'returned no image',
    );
  });

  it('listModels filters to image-capable models; testConnection probes /models', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({
        data: [
          { id: 'img-model', name: 'Img', architecture: { output_modalities: ['image'] } },
          { id: 'txt-model', name: 'Txt', architecture: { output_modalities: ['text'] } },
        ],
      }),
    );
    const adapter: any = openrouterMediaModule.create(ctx as any);

    const models = await adapter.listModels('image', { apiKey: 'or-key' });
    expect(models).toEqual([{ id: 'img-model', label: 'Img' }]);
    expect(recs[0].url).toBe('https://openrouter.ai/api/v1/models');

    const tc = await adapter.testConnection({ apiKey: 'or-key' });
    expect(tc.ok).toBe(true);
  });

  it('listModels returns empty for non-image operations without hitting the network', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = openrouterMediaModule.create(ctx as any);
    expect(await adapter.listModels('video', { apiKey: 'or-key' })).toEqual([]);
    expect(recs).toHaveLength(0);
  });

  it('rejects a missing model, a missing key, and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = openrouterMediaModule.create(ctx as any);
    // Model is checked before credentials.
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow('requires a model');
    await expect(adapter.generateImage('x', { model: 'm' })).rejects.toThrow('API key is required');
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
