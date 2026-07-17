import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { replicateMediaModule } from './media.adapter';

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
    expect(out.error).toBe('boom');
  });

  it('rejects a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = replicateMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateImage('x', {})).rejects.toThrow('API key is required');
  });

  // NEEDS-LIVE-SMOKE-TEST
  it('routes sourceUrl to video-to-video and includes video_url in the input', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-v2v', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('restyle this', {
      apiKey: 'replicate-key',
      version: 'owner/video-to-video-model',
      sourceUrl: 'https://cdn.example.com/input.mp4',
    });

    expect(sub.jobId).toBe('pred-v2v');
    const r = recs[0];
    // 2.5 — a slug routes to the models endpoint (no `version` field in the body).
    expect(r.url).toBe('https://api.replicate.com/v1/models/owner/video-to-video-model/predictions');
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({
      prompt: 'restyle this',
      video_url: 'https://cdn.example.com/input.mp4',
    });
  });

  // NEEDS-LIVE-SMOKE-TEST
  it('routes options.input.video_url to video-to-video and preserves the field', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-v2v-input', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('restyle this', {
      apiKey: 'replicate-key',
      model: 'owner/video-to-video-model',
      input: { video_url: 'https://cdn.example.com/from-input.mp4', num_frames: 24 },
    });

    expect(sub.jobId).toBe('pred-v2v-input');
    const r = recs[0];
    expect(r.url).toBe('https://api.replicate.com/v1/models/owner/video-to-video-model/predictions');
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({
      prompt: 'restyle this',
      video_url: 'https://cdn.example.com/from-input.mp4',
      num_frames: 24,
    });
  });

  it('rejects video-to-video without an explicit model/version', async () => {
    const { ctx } = makeCtx(() => res({ id: 'pred-v2v', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    await expect(
      adapter.generateVideo('restyle this', {
        apiKey: 'replicate-key',
        sourceUrl: 'https://cdn.example.com/input.mp4',
      }),
    ).rejects.toThrow('Replicate video-to-video requires an explicit model/version');
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
  it('submits video background removal with the expected model and video input', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'pred-bg', status: 'starting' }));
    const adapter: any = replicateMediaModule.create(ctx as any);

    const sub = await adapter.removeVideoBackground('https://cdn.example.com/with-bg.mp4', {
      apiKey: 'replicate-key',
    });

    expect(sub.jobId).toBe('pred-bg');
    const r = recs[0];
    expect(r.url).toBe(
      'https://api.replicate.com/v1/models/arielreplicate/robust_video_matting/predictions',
    );
    const body = JSON.parse(r.body);
    expect(body.version).toBeUndefined();
    expect(body.input).toEqual({
      video: 'https://cdn.example.com/with-bg.mp4',
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
      'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
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
