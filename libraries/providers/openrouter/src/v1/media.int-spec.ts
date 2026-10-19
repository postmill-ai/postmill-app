import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
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

  it('allows 120s for slow image models and converts a safeFetch timeout into an attributed upstream error', async () => {
    let seenTimeout: number | undefined;
    const { ctx } = makeCtx((_url, init) => {
      seenTimeout = init.timeoutMs;
      throw new Error('safeFetch request timed out after 120000ms');
    });
    const adapter: any = openrouterMediaModule.create(ctx as any);

    const err = await adapter
      .generateImage('x', { apiKey: 'or-key', model: 'openai/gpt-image-1' })
      .catch((e: unknown) => e);

    expect(seenTimeout).toBe(120_000);
    expect(err.name).toBe('ProviderUpstreamError');
    expect(err.kind).toBe('timeout');
    expect(err.message).toBe('OpenRouter did not answer in time: safeFetch request timed out after 120000ms');
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

// UNVERIFIED vs live key: the chat-completions image shapes below
// (`modalities`, `message.images[].image_url.url`) follow OpenRouter's
// published image-generation docs for the gemini-image family; no recorded
// live response was available.
describe('openrouter media adapter image-to-image (sourceUrl)', () => {
  it('routes a sourceUrl through chat/completions with an image_url content part for gemini image models', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({
        choices: [
          {
            message: {
              images: [
                { type: 'image_url', image_url: { url: 'data:image/png;base64,WFla' } },
              ],
            },
          },
        ],
      }),
    );
    const adapter: any = openrouterMediaModule.create(ctx as any);

    const out = await adapter.generateImage('match this reference', {
      apiKey: 'or-key',
      model: 'google/gemini-2.5-flash-image',
      sourceUrl: 'data:image/jpeg;base64,QUJD',
    });

    const r = recs[0];
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer or-key');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('google/gemini-2.5-flash-image');
    expect(body.modalities).toEqual(['image', 'text']);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      { type: 'text', text: 'match this reference' },
    ]);

    expect(out.image).toBe('data:image/png;base64,WFla');
    expect(out.images).toEqual(['data:image/png;base64,WFla']);
    expect(out.multi).toBe(false);
  });

  it('passes an https source URL through verbatim', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({
        choices: [
          { message: { images: [{ image_url: { url: 'https://cdn.or/out.png' } }] } },
        ],
      }),
    );
    const adapter: any = openrouterMediaModule.create(ctx as any);

    const out = await adapter.generateImage('x', {
      apiKey: 'or-key',
      model: 'google/gemini-2.5-flash-image',
      sourceUrl: 'https://cdn.example/ref.png',
    });

    expect(JSON.parse(recs[0].body).messages[0].content[0].image_url.url).toBe(
      'https://cdn.example/ref.png',
    );
    expect(out.image).toBe('https://cdn.or/out.png');
  });

  it('throws for a non-gemini model rather than silently dropping the source image', async () => {
    const { recs, ctx } = makeCtx(() => res({}));
    const adapter: any = openrouterMediaModule.create(ctx as any);

    await expect(
      adapter.generateImage('x', {
        apiKey: 'or-key',
        model: 'openai/gpt-image-1',
        sourceUrl: 'https://cdn.example/ref.png',
      }),
    ).rejects.toThrow('does not accept image input');
    expect(recs).toHaveLength(0);
  });

  it('throws when the chat response carries no images', async () => {
    const { ctx } = makeCtx(() => res({ choices: [{ message: {} }] }));
    const adapter: any = openrouterMediaModule.create(ctx as any);

    await expect(
      adapter.generateImage('x', {
        apiKey: 'or-key',
        model: 'google/gemini-2.5-flash-image',
        sourceUrl: 'https://cdn.example/ref.png',
      }),
    ).rejects.toThrow('returned no image');
  });
});
