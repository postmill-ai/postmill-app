import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { siliconflowMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. SiliconFlow rides the
// OpenAI-compatible base for synchronous image (`POST /v1/images/generations`) and overrides
// video with its own async job API (`POST /v1/video/submit` → poll `POST /v1/video/status`).

describe('siliconflow media adapter (sync image + async video)', () => {
  it('submits video to /v1/video/submit with Bearer auth and routes model/prompt/input into the body', async () => {
    const { recs, ctx } = makeCtx(() => res({ requestId: 'req-9' }));
    const adapter: any = siliconflowMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'sf-key',
      model: 'Wan-AI/Wan2.1-T2V-14B',
      input: { negative_prompt: 'blurry', seed: 3 },
    });

    expect(sub.jobId).toBe('req-9');
    const r = recs[0];
    expect(r.url).toBe('https://api.siliconflow.com/v1/video/submit');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer sf-key');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('Wan-AI/Wan2.1-T2V-14B');
    expect(body.prompt).toBe('a cat surfing');
    expect(body.negative_prompt).toBe('blurry');
    expect(body.seed).toBe(3);
  });

  it('pollJob POSTs to /v1/video/status and parses InQueue → pending and Succeed → completed', async () => {
    const pendingCtx = makeCtx(() => res({ status: 'InQueue' }));
    const pendingAdapter: any = siliconflowMediaModule.create(pendingCtx.ctx as any);
    const pending = await pendingAdapter.pollJob('req-9', { apiKey: 'sf-key' });
    expect(pending.status).toBe('pending');
    expect(pendingCtx.recs[0].url).toBe('https://api.siliconflow.com/v1/video/status');
    expect(pendingCtx.recs[0].method).toBe('POST');
    expect(JSON.parse(pendingCtx.recs[0].body)).toEqual({ requestId: 'req-9' });

    const doneCtx = makeCtx(() =>
      res({ status: 'Succeed', results: { videos: [{ url: 'https://cdn.sf/out.mp4' }] } }),
    );
    const doneAdapter: any = siliconflowMediaModule.create(doneCtx.ctx as any);
    const done = await doneAdapter.pollJob('req-9', { apiKey: 'sf-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.sf/out.mp4');
  });

  it('generateImage POSTs synchronously to /v1/images/generations and parses data[].url', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [{ url: 'https://cdn.sf/img.png' }] }));
    const adapter: any = siliconflowMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a fox', { apiKey: 'sf-key', model: 'flux' });
    expect(recs[0].url).toBe('https://api.siliconflow.com/v1/images/generations');
    expect(out.image).toBe('https://cdn.sf/img.png');
  });

  it('rejects a missing key, a video without a model, and unsupported avatar generation', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = siliconflowMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('SiliconFlow API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow('requires a model');
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
