import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { deepinfraMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. DeepInfra media uses the native
// per-model inference endpoint POST /v1/inference/{model}, which is synchronous and returns the
// artifact inline. Image, TTS/audio, and text-to-video all ride this one shape; there is no
// pollJob (audio/video return a completed MediaJobSubmission with the artifact already set).

describe('deepinfra media adapter (native per-model inference)', () => {
  it('generateImage POSTs to /v1/inference/{model} with Bearer auth and a {prompt,...input} body, parsing images[]', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ images: ['https://cdn.deepinfra/out.png'] }),
    );
    const adapter: any = deepinfraMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a koi pond', {
      apiKey: 'di-key',
      model: 'black-forest-labs/FLUX-1-schnell',
      input: { width: 1024, num_images: 1, empty: '' },
    });

    const r = recs[0];
    expect(r.url).toBe('https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer di-key');
    expect(r.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a koi pond');
    expect(body.width).toBe(1024);
    expect(body.num_images).toBe(1);
    // `_clean` drops empty-string fields.
    expect('empty' in body).toBe(false);

    expect(out.image).toBe('https://cdn.deepinfra/out.png');
    expect(out.images).toEqual(['https://cdn.deepinfra/out.png']);
  });

  it('wraps a bare base64 image payload into a data: URL', async () => {
    const { ctx } = makeCtx(() => res({ image: 'QUJD' }));
    const adapter: any = deepinfraMediaModule.create(ctx as any);
    const out = await adapter.generateImage('x', { apiKey: 'di-key', model: 'm' });
    expect(out.image).toBe('data:image/png;base64,QUJD');
  });

  it('generateAudio sends {text,...} and returns a completed job with the audio artifact', async () => {
    const { recs, ctx } = makeCtx(() => res({ audio: 'https://cdn.deepinfra/out.wav' }));
    const adapter: any = deepinfraMediaModule.create(ctx as any);

    const sub = await adapter.generateAudio('hello world', {
      apiKey: 'di-key',
      model: 'hexgrad/Kokoro-82M',
    });

    const body = JSON.parse(recs[0].body);
    expect(body.text).toBe('hello world');
    expect(sub.jobId).toBe('deepinfra-audio-hexgrad/Kokoro-82M');
    expect(sub.artifactUrl).toBe('https://cdn.deepinfra/out.wav');
  });

  it('generateVideo sends {prompt,...} and returns a completed job with the video artifact', async () => {
    const { recs, ctx } = makeCtx(() => res({ video_url: 'https://cdn.deepinfra/out.mp4' }));
    const adapter: any = deepinfraMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a rocket launch', {
      apiKey: 'di-key',
      model: 'some/video-model',
    });

    const body = JSON.parse(recs[0].body);
    expect(body.prompt).toBe('a rocket launch');
    expect(sub.jobId).toBe('deepinfra-video-some/video-model');
    expect(sub.artifactUrl).toBe('https://cdn.deepinfra/out.mp4');
  });

  it('testConnection probes the OpenAI-compatible models list', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = deepinfraMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'di-key' });
    expect(tc.ok).toBe(true);
    expect(recs[0].url).toBe('https://api.deepinfra.com/v1/openai/models');
  });

  it('rejects a missing model, a missing key, and unsupported avatar', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = deepinfraMediaModule.create(ctx as any);
    // Model is checked first inside _infer.
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow('requires a model');
    await expect(adapter.generateImage('x', { model: 'm' })).rejects.toThrow('API key is required');
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support avatar',
    );
  });
});
