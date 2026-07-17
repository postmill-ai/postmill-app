import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { falMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. fal has a synchronous image path
// (`POST https://fal.run/<model>`) and an async queue for video/audio
// (`POST https://queue.fal.run/<model>` → poll `.../requests/<id>/status` then `.../requests/<id>`).

describe('fal media adapter (sync image + queued video)', () => {
  it('submits video to the queue endpoint with Key auth and routes prompt/input into the body', async () => {
    const { recs, ctx } = makeCtx(() => res({ request_id: 'req-1' }));
    const adapter: any = falMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'fal-key',
      model: 'fal-ai/kling-video/v1.6/standard/text-to-video',
      input: { duration: 5, aspect_ratio: '16:9' },
    });

    // job ids carry the model path: `<model>::<request_id>`.
    expect(sub.jobId).toBe('fal-ai/kling-video/v1.6/standard/text-to-video::req-1');
    const r = recs[0];
    expect(r.url).toBe('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Key fal-key');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a cat surfing');
    expect(body.duration).toBe(5);
    expect(body.aspect_ratio).toBe('16:9');
  });

  it('pollJob parses IN_PROGRESS → pending and COMPLETED → completed with the result artifact', async () => {
    const jobId = 'fal-ai/kling-video/v1.6/standard/text-to-video::req-1';

    const pendingCtx = makeCtx(() => res({ status: 'IN_PROGRESS' }));
    const pendingAdapter: any = falMediaModule.create(pendingCtx.ctx as any);
    const pending = await pendingAdapter.pollJob(jobId, { apiKey: 'fal-key' });
    expect(pending.status).toBe('pending');
    expect(pendingCtx.recs[0].url).toBe(
      'https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video/requests/req-1/status',
    );

    const doneCtx = makeCtx((url) =>
      url.endsWith('/status')
        ? res({ status: 'COMPLETED' })
        : res({ video: { url: 'https://cdn.fal/out.mp4' } }),
    );
    const doneAdapter: any = falMediaModule.create(doneCtx.ctx as any);
    const done = await doneAdapter.pollJob(jobId, { apiKey: 'fal-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.fal/out.mp4');
    expect(doneCtx.recs[1].url).toBe(
      'https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video/requests/req-1',
    );
  });

  it('generateImage POSTs synchronously to fal.run and parses images[].url', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ images: [{ url: 'https://cdn.fal/img.png', width: 1024, height: 1024 }], seed: 7 }),
    );
    const adapter: any = falMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a fox', {
      apiKey: 'fal-key',
      model: 'fal-ai/flux/schnell',
    });
    expect(recs[0].url).toBe('https://fal.run/fal-ai/flux/schnell');
    expect(recs[0].method).toBe('POST');
    const body = JSON.parse(recs[0].body);
    expect(body.prompt).toBe('a fox');
    expect(body.num_images).toBe(1);
    expect(out.image).toBe('https://cdn.fal/img.png');
  });

  it('2.1: a 503 on the status poll THROWS (transient); FAILED status → returned failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = falMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('fal-ai/kling::req-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const f = makeCtx(() => res({ status: 'FAILED', error: 'model error' }));
    const a2: any = falMediaModule.create(f.ctx as any);
    expect((await a2.pollJob('fal-ai/kling::req-1', { apiKey: 'k' })).status).toBe('failed');
  });

  it('2.1: a 5xx on the post-COMPLETED result fetch THROWS (render already succeeded)', async () => {
    const { ctx } = makeCtx((url) =>
      url.endsWith('/status') ? res({ status: 'COMPLETED' }) : res('gone', false, 502),
    );
    const adapter: any = falMediaModule.create(ctx as any);
    await expect(adapter.pollJob('fal-ai/kling::req-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);
  });

  it('2.1: missing key on poll → terminal failed (not thrown)', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = falMediaModule.create(ctx as any);
    const r = await adapter.pollJob('fal-ai/kling::req-1', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/key is required/);
  });

  it('rejects a missing key and unsupported avatar generation', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = falMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('fal.ai API key is required');
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('fal.ai API key is required');
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });

  // 6.1i — a legacy (un-namespaced) job id can't route to a model path → terminal failed.
  it('pollJob fails terminally on a legacy un-namespaced job id', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = falMediaModule.create(ctx as any);
    const r = await adapter.pollJob('legacy-request-id', { apiKey: 'k' });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/legacy job id/);
  });

  // 6.1b — a model id with an injected query/path is rejected before interpolation.
  it('generateImage rejects a model id with query injection', async () => {
    const { ctx } = makeCtx(() => res({ images: [] }));
    const adapter: any = falMediaModule.create(ctx as any);
    await expect(
      adapter.generateImage('x', { apiKey: 'k', model: 'fal-ai/flux?fal_webhook=https://evil' }),
    ).rejects.toThrow(/Invalid model id/);
  });
});
