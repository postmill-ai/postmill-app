import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { togetheraiMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Together rides the OpenAI-compatible
// base for the synchronous image path (`POST /v1/images/generations`) and overrides video with
// its own async job API (`POST /v1/videos` → poll `GET /v1/videos/{id}`, `outputs.video_url`).

describe('togetherai media adapter (sync image + async video)', () => {
  it('submits video to /v1/videos with Bearer auth and routes a frame_image into media.frame_images[]', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'vid-1', status: 'queued' }));
    const adapter: any = togetheraiMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'tg-key',
      model: 'some/video-model',
      input: { duration: 5, frame_image: 'https://cdn/frame.png' },
    });

    expect(sub.jobId).toBe('vid-1');
    const r = recs[0];
    expect(r.url).toBe('https://api.together.ai/v1/videos');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer tg-key');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('some/video-model');
    expect(body.prompt).toBe('a cat surfing');
    expect(body.duration).toBe(5);
    // frame_image is lifted out and nested under media.frame_images for i2v.
    expect(body.frame_image).toBeUndefined();
    expect(body.media).toEqual({ frame_images: ['https://cdn/frame.png'] });
  });

  it('pollJob parses an in-progress status → pending and completed → completed with outputs.video_url', async () => {
    const pendingCtx = makeCtx(() => res({ status: 'in_progress' }));
    const pendingAdapter: any = togetheraiMediaModule.create(pendingCtx.ctx as any);
    const pending = await pendingAdapter.pollJob('vid-1', { apiKey: 'tg-key' });
    expect(pending.status).toBe('pending');
    expect(pendingCtx.recs[0].url).toBe('https://api.together.ai/v1/videos/vid-1');

    const doneCtx = makeCtx(() =>
      res({ status: 'completed', outputs: { video_url: 'https://cdn.together/out.mp4' } }),
    );
    const doneAdapter: any = togetheraiMediaModule.create(doneCtx.ctx as any);
    const done = await doneAdapter.pollJob('vid-1', { apiKey: 'tg-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.together/out.mp4');
  });

  it('generateImage POSTs synchronously to /v1/images/generations and parses data[].url', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [{ url: 'https://cdn.together/img.png' }] }));
    const adapter: any = togetheraiMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a fox', { apiKey: 'tg-key', model: 'flux' });
    expect(recs[0].url).toBe('https://api.together.ai/v1/images/generations');
    const body = JSON.parse(recs[0].body);
    expect(body.model).toBe('flux');
    expect(body.prompt).toBe('a fox');
    expect(out.image).toBe('https://cdn.together/img.png');
  });

  it('rejects a missing key, a video without a model, and unsupported avatar generation', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = togetheraiMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('Together AI API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow(
      'requires a model',
    );
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
