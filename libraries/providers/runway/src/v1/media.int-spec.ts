import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { runwayMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Runway: video is async submit
// (POST /image_to_video → id) then poll (GET /tasks/{id} → status + output[]). Image is
// synchronous via bounded internal polling (POST /text_to_image then poll). Bearer auth +
// X-Runway-Version header.

describe('runway media adapter', () => {
  it('submits video generation to /image_to_video with Bearer auth, the version header, and the source image', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'task-123' }));
    const adapter: any = runwayMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'runway-key',
      model: 'gen4_turbo',
      durationSeconds: 10,
      input: { promptImage: 'https://img/me.png', seed: 7 },
    });

    expect(sub.jobId).toBe('task-123');
    const r = recs[0];
    expect(r.url).toBe('https://api.dev.runwayml.com/v1/image_to_video');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer runway-key');
    expect(r.headers['X-Runway-Version']).toBe('2024-11-06');
    const body = JSON.parse(r.body);
    expect(body.promptImage).toBe('https://img/me.png');
    expect(body.promptText).toBe('a cat surfing');
    expect(body.model).toBe('gen4_turbo');
    expect(body.duration).toBe(10);
    // Remaining native input params ride straight into the body.
    expect(body.seed).toBe(7);
  });

  it('pollJob parses RUNNING → pending and SUCCEEDED → completed with output[0]', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ status: 'RUNNING' })
        : res({ status: 'SUCCEEDED', output: ['https://cdn.runway/out.mp4'] }),
    );
    const adapter: any = runwayMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('task-123', { apiKey: 'runway-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('task-123', { apiKey: 'runway-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.runway/out.mp4');
  });

  it('generateImage POSTs to /text_to_image and bounded-polls to completed', async () => {
    const { recs, ctx } = makeCtx((url) => {
      if (url.endsWith('/text_to_image')) return res({ id: 'img-1' });
      return res({ status: 'SUCCEEDED', output: ['https://cdn.runway/img.png'] });
    });
    const adapter: any = runwayMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a sunset', { apiKey: 'runway-key', model: 'gen4_image' });
    expect(recs[0].url).toBe('https://api.dev.runwayml.com/v1/text_to_image');
    expect(out.image).toBe('https://cdn.runway/img.png');
  }, 15000);

  it('rejects unsupported audio/avatar and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = runwayMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', { input: { promptImage: 'https://i/x.png' } })).rejects.toThrow(
      'API key is required',
    );
  });

  // 3.4 — a transient 5xx poll must THROW (lifecycle retries); a 4xx returns terminal failed.
  it('pollJob throws on a 503 (transient → retry)', async () => {
    const { ctx } = makeCtx(() => res('upstream down', false, 503));
    const adapter: any = runwayMediaModule.create(ctx as any);
    await expect(adapter.pollJob('task-1', { apiKey: 'runway-key' })).rejects.toThrow(/transient/);
  });

  it('pollJob returns terminal failed on a 400', async () => {
    const { ctx } = makeCtx(() => res('bad request', false, 400));
    const adapter: any = runwayMediaModule.create(ctx as any);
    const out = await adapter.pollJob('task-1', { apiKey: 'runway-key' });
    expect(out.status).toBe('failed');
  });

  it('pollJob returns failed (not throw) when the key is missing', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = runwayMediaModule.create(ctx as any);
    const out = await adapter.pollJob('task-1', {});
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/API key/);
  });
});
