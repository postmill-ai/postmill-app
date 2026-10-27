import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { replicateMediaModule, ReplicateMediaAdapter } from './media.adapter';
import { metadata as providerMetadata } from './metadata';

// Recorded-fixture integration test (plan B4) — no network. Replicate: video/audio/avatar
// are async submit (POST /predictions → id) then poll (GET /predictions/{id} → status +
// output). Credentials resolve via resolveApiKey (Bearer).

describe('replicate media adapter (async predictions)', () => {
  it('submits video generation to /predictions with Bearer auth, version, and merged input', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-123', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'replicate-key',
      version: 'some-model-version',
      input: { num_frames: 24 },
    });

    expect(sub.jobId).toBe('pred-123');
    const r = recs[0];
    expect(r.url).toBe('https://api.replicate.com/v1/predictions');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer replicate-key');
    const body = JSON.parse(r.body);
    expect(body.version).toBe('some-model-version');
    // prompt + native input params are merged into the prediction input.
    expect(body.input).toEqual({ prompt: 'a cat surfing', num_frames: 24 });
  });

  it('pollJob parses processing → pending and succeeded → completed with the output URL', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ id: 'pred-123', status: 'processing' })
        : res({ id: 'pred-123', status: 'succeeded', output: ['https://cdn.replicate/out.mp4'] }),
    );
    const adapter: any = replicateMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('pred-123', { apiKey: 'replicate-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('pred-123', { apiKey: 'replicate-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.replicate/out.mp4');
  });

  it('pollJob maps failed → failed with the error message', async () => {
    const { ctx } = makeCtx(() => res({ id: 'pred-123', status: 'failed', error: 'boom' }));
    const adapter: any = replicateMediaModule.create(ctx as any);
    const out = await adapter.pollJob('pred-123', { apiKey: 'replicate-key' });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('Replicate returned an error: boom');
  });

  it('rejects a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = replicateMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateImage('x', {})).rejects.toThrow('API key is required');
  });

  it('routes a video source to the declared v2v model’s native `video` field', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-v2v', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('restyle this', {
      apiKey: 'replicate-key',
      version: 'wan-video/wan-2.7-videoedit',
      sourceUrl: 'https://cdn.example.com/input.mp4',
    });

    expect(sub.jobId).toBe('pred-v2v');
    const r = recs[0];
    // 2.5 — a slug routes to the models endpoint (no `version` field in the body).
    expect(r.url).toBe('https://api.replicate.com/v1/models/wan-video/wan-2.7-videoedit/predictions');
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    // Verified against the live Replicate schema: wan-2.7-videoedit takes a
    // required `video` uri input (NOT `video_url` — no allowlisted model
    // accepts that name).
    expect(body.input).toEqual({
      prompt: 'restyle this',
      video: 'https://cdn.example.com/input.mp4',
    });
  });

  it('consumes options.input.video_url onto the native field instead of forwarding it', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-v2v-input', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('restyle this', {
      apiKey: 'replicate-key',
      model: 'wan-video/wan-2.7-videoedit',
      input: { video_url: 'https://cdn.example.com/from-input.mp4', resolution: '1080p' },
    });

    expect(sub.jobId).toBe('pred-v2v-input');
    const r = recs[0];
    expect(r.url).toBe('https://api.replicate.com/v1/models/wan-video/wan-2.7-videoedit/predictions');
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({
      prompt: 'restyle this',
      video: 'https://cdn.example.com/from-input.mp4',
      resolution: '1080p',
    });
  });

  it('strips org media-default tunables the target model does not declare', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-i2v', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('animate this', {
      apiKey: 'replicate-key',
      model: 'kwaivgi/kling-v2.5-turbo-pro',
      sourceUrl: 'https://cdn.example.com/frame.png',
      input: { unsupported_tunable: '16:9', duration: '10' },
    });

    expect(sub.jobId).toBe('pred-i2v');
    const body = JSON.parse(recs[0].body);
    expect(body.input).toEqual({
      prompt: 'animate this',
      start_image: 'https://cdn.example.com/frame.png',
      duration: '10',
    });
  });

  // Per-model image-source field map, verified against the live Replicate
  // schemas: minimax wants `first_frame_image`, seedance `image`, kling
  // `start_image`. The old hardcoded `video_url` 422'd on every one of these.
  it.each([
    ['google/veo-3.1', 'image'],
    ['minimax/video-01', 'first_frame_image'],
    ['bytedance/seedance-1-pro', 'image'],
    ['kwaivgi/kling-v2.5-turbo-pro', 'start_image'],
  ])('maps an image source to %s’s native `%s` input', async (model, field) => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-i2v', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await adapter.generateVideo('animate this', {
      apiKey: 'replicate-key',
      model,
      sourceUrl: 'https://cdn.example.com/frame.png',
    });

    const body = JSON.parse(recs[0].body);
    expect(body.input).toEqual({
      prompt: 'animate this',
      [field]: 'https://cdn.example.com/frame.png',
    });
  });

  it('throws for a source-driven call with a model that declares no source input', async () => {
    const { ctx } = makeCtx(() => res({ id: 'pred-x', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await expect(
      adapter.generateVideo('animate this', {
        apiKey: 'replicate-key',
        model: 'black-forest-labs/flux-dev',
        sourceUrl: 'https://cdn.example.com/frame.png',
      }),
    ).rejects.toThrow(
      'Replicate model black-forest-labs/flux-dev does not declare an image-to-video or video-to-video source input',
    );
    await expect(
      adapter.generateVideo('animate this', {
        apiKey: 'replicate-key',
        model: 'owner/totally-unknown',
        sourceUrl: 'https://cdn.example.com/frame.png',
      }),
    ).rejects.toThrow(
      'Replicate model owner/totally-unknown does not declare an image-to-video or video-to-video source input',
    );
  });

  it.each([
    ['google/veo-3.1', 5],
    ['bytedance/seedance-1-pro', 6],
    ['kwaivgi/kling-v2.5-turbo-pro', 2],
    ['minimax/video-01', 6],
  ])('rejects invalid %s duration %s before submitting', async (model, duration) => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-x', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await expect(
      adapter.generateVideo('x', { apiKey: 'replicate-key', model, input: { duration } }),
    ).rejects.toThrow(/duration/);
    expect(recs).toHaveLength(0);
  });

  it('submits Veo reference_images as a true array after validating reference mode', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-veo-ref', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);
    const referenceImages = [
      'https://cdn.example.com/one.png',
      'https://cdn.example.com/two.png',
      'https://cdn.example.com/three.png',
    ];

    await adapter.generateVideo('x', {
      apiKey: 'replicate-key',
      model: 'google/veo-3.1',
      input: { reference_images: referenceImages, aspect_ratio: '16:9', duration: '8' },
    });

    const body = JSON.parse(recs[0].body);
    expect(body.input.reference_images).toEqual(referenceImages);
    expect(body.input.duration).toBe('8');
    expect(body.input.aspect_ratio).toBe('16:9');
  });

  it.each([
    ['scalar', { reference_images: 'one,two', aspect_ratio: '16:9', duration: 8 }],
    ['too many', { reference_images: ['1', '2', '3', '4'], aspect_ratio: '16:9', duration: 8 }],
    ['wrong aspect', { reference_images: ['1'], aspect_ratio: '9:16', duration: 8 }],
    ['wrong duration', { reference_images: ['1'], aspect_ratio: '16:9', duration: 6 }],
    [
      'last frame conflict',
      {
        reference_images: ['1'],
        aspect_ratio: '16:9',
        duration: 8,
        last_frame: 'https://cdn.example.com/last.png',
      },
    ],
  ])('rejects Veo reference mode with %s before submitting', async (_label, input) => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-x', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await expect(
      adapter.generateVideo('x', { apiKey: 'replicate-key', model: 'google/veo-3.1', input }),
    ).rejects.toThrow();
    expect(recs).toHaveLength(0);
  });

  it.each([[], null])('drops empty/null Veo references as unset (%s)', async (references) => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-veo', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await adapter.generateVideo('x', {
      apiKey: 'replicate-key',
      model: 'google/veo-3.1',
      input: { reference_images: references, aspect_ratio: '9:16', duration: 6 },
    });

    const body = JSON.parse(recs[0].body);
    expect(body.input).not.toHaveProperty('reference_images');
    expect(body.input.aspect_ratio).toBe('9:16');
    expect(body.input.duration).toBe(6);
  });

  it('rejects the discontinued Kling 2.1 Master before submitting', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-x', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await expect(
      adapter.generateVideo('animate this', {
        apiKey: 'replicate-key',
        model: 'kwaivgi/kling-v2.1-master',
      }),
    ).rejects.toThrow('discontinued. Use kwaivgi/kling-v2.5-turbo-pro instead');
    expect(recs).toHaveLength(0);
  });

  it('knows a source field for every declared i2v/v2v catalog model', () => {
    // Guard against catalog drift: a model added to a source-driven category
    // without a field-map entry would throw at generation time (by design) —
    // fail here instead, at test time.
    const models = (providerMetadata.mediaModels as Record<string, { id: string }[]>);
    for (const category of ['image-to-video', 'video-to-video']) {
      for (const m of models[category] ?? []) {
        expect(
          (ReplicateMediaAdapter as any)._videoSourceInputField(m.id),
          `${m.id} (${category}) has no source-field mapping`,
        ).not.toBeNull();
      }
    }
  });

  it('rejects video-to-video without an explicit model/version', async () => {
    const { ctx } = makeCtx(() => res({ id: 'pred-v2v', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await expect(
      adapter.generateVideo('restyle this', {
        apiKey: 'replicate-key',
        sourceUrl: 'https://cdn.example.com/input.mp4',
      }),
    ).rejects.toThrow('Replicate source-driven video generation requires an explicit model/version');
  });

  // NEEDS-LIVE-SMOKE-TEST
  it('submits video upscale with the expected model/version and video input', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-upscale', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.upscaleVideo('https://cdn.example.com/low.mp4', {
      apiKey: 'replicate-key',
    });

    expect(sub.jobId).toBe('pred-upscale');
    const r = recs[0];
    // Slug default → models endpoint.
    expect(r.url).toBe('https://api.replicate.com/v1/models/lucataco/real-esrgan-video/predictions');
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({
      video: 'https://cdn.example.com/low.mp4',
      scale: 4,
    });
  });

  // NEEDS-LIVE-SMOKE-TEST
  it('submits video background removal with the default model and video input', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-bg', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.removeVideoBackground('https://cdn.example.com/with-bg.mp4', {
      apiKey: 'replicate-key',
    });

    expect(sub.jobId).toBe('pred-bg');
    const r = recs[0];
    // Default is rembg-video (general salient objects); robust_video_matting
    // (people-only) stays selectable by pinning the model.
    expect(r.url).toBe(
      'https://api.replicate.com/v1/models/lucataco/rembg-video/predictions',
    );
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({
      video: 'https://cdn.example.com/with-bg.mp4',
      background_color: '#00FF00',
    });
  });

  it('routes rembg-video (object matting) with its own field names when selected', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-bg2', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.removeVideoBackground('https://cdn.example.com/product.mp4', {
      apiKey: 'replicate-key',
      model: 'lucataco/rembg-video',
    });

    expect(sub.jobId).toBe('pred-bg2');
    const r = recs[0];
    expect(r.url).toBe(
      'https://api.replicate.com/v1/models/lucataco/rembg-video/predictions',
    );
    const body = JSON.parse(r.body);
    expect(body.input).toEqual({
      video: 'https://cdn.example.com/product.mp4',
      background_color: '#00FF00',
    });
  });

  // 2.5 — model reference routing: slug vs version hash.
  it('routes a default slug (generateImage) to /models/{slug}/predictions with no version field', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ id: 'img-1', status: 'succeeded', output: ['https://cdn.replicate/img.png'] }),
    );
    const adapter: any = replicateMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a fox', { apiKey: 'replicate-key' });
    expect(out.image).toBe('https://cdn.replicate/img.png');
    const r = recs[0];
    expect(r.url).toBe(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions',
    );
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({ prompt: 'a fox' });
    // Prefer wait stays within the 30s outbound budget (2.4).
    expect(r.headers.Prefer).toBe('wait=25');
  });

  it('routes a bare version hash to /predictions with a version field', async () => {
    const hash = 'a'.repeat(64);
    const { recs, ctx } = makeCtx(() =>
      res({ id: 'img-2', status: 'succeeded', output: ['https://cdn.replicate/img2.png'] }),
    );
    const adapter: any = replicateMediaModule.create(ctx as any);
    await adapter.generateImage('a fox', { apiKey: 'replicate-key', version: hash });
    const r = recs[0];
    expect(r.url).toBe('https://api.replicate.com/v1/predictions');
    expect(JSON.parse(r.body).version).toBe(hash);
  });

  // 2.4 — a still-processing create response falls back to polling instead of returning ''/throwing.
  it('generateImage polls a processing create response to completion', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ id: 'img-3', status: 'processing' })
        : res({ id: 'img-3', status: 'succeeded', output: ['https://cdn.replicate/late.png'] }),
    );
    const adapter: any = replicateMediaModule.create(ctx as any);
    const out = await adapter.generateImage('slow', { apiKey: 'replicate-key' });
    expect(out.image).toBe('https://cdn.replicate/late.png');
  });

  it('upscaleImage returns a URL after polling a processing response (never "")', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ id: 'up-1', status: 'processing' })
        : res({ id: 'up-1', status: 'succeeded', output: 'https://cdn.replicate/up.png' }),
    );
    const adapter: any = replicateMediaModule.create(ctx as any);
    const url = await adapter.upscaleImage('https://cdn.example.com/in.png', { apiKey: 'replicate-key' });
    expect(url).toBe('https://cdn.replicate/up.png');
  });

  // 3.4 — a transient 5xx poll response throws (retryable), a 4xx returns terminal failed.
  it('pollJob throws on a 503 poll response (transient → retry)', async () => {
    const { ctx } = makeCtx(() => res('upstream unavailable', false, 503));
    const adapter: any = replicateMediaModule.create(ctx as any);
    await expect(adapter.pollJob('pred-x', { apiKey: 'replicate-key' })).rejects.toThrow(/transient/);
  });

  it('pollJob returns terminal failed on a 404 poll response', async () => {
    const { ctx } = makeCtx(() => res('not found', false, 404));
    const adapter: any = replicateMediaModule.create(ctx as any);
    const out = await adapter.pollJob('pred-x', { apiKey: 'replicate-key' });
    expect(out.status).toBe('failed');
  });

  it('pollJob returns failed (not throw) when the key is missing', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = replicateMediaModule.create(ctx as any);
    const out = await adapter.pollJob('pred-x', {});
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/API key/);
  });
});

describe('replicate media adapter testConnection', () => {
  it('GETs /v1/models with Bearer auth — 200 ok, 401 Invalid API key, 500 throws, missing key', async () => {
    const okCtx = makeCtx(() => res({ results: [] }));
    const a1: any = replicateMediaModule.create(okCtx.ctx as any);
    expect(await a1.testConnection({ apiKey: 'r8_key' })).toEqual({ ok: true, message: 'Connection successful' });
    expect(okCtx.recs[0].url).toBe('https://api.replicate.com/v1/models');
    expect(okCtx.recs[0].method).toBe('GET');
    expect(okCtx.recs[0].headers.Authorization).toBe('Bearer r8_key');

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a2: any = replicateMediaModule.create(bad.ctx as any);
    expect(await a2.testConnection({ apiKey: 'wrong' })).toEqual({ ok: false, message: 'Invalid API key' });

    const err = makeCtx(() => res('boom', false, 500));
    const a3: any = replicateMediaModule.create(err.ctx as any);
    await expect(a3.testConnection({ apiKey: 'r8_key' })).rejects.toThrow(/connection test failed \(500\)/);

    const noKey = makeCtx(() => res({}));
    const a4: any = replicateMediaModule.create(noKey.ctx as any);
    expect(await a4.testConnection({})).toEqual({ ok: false, message: 'Replicate API key is required' });
    expect(noKey.recs).toHaveLength(0);
  });
});
