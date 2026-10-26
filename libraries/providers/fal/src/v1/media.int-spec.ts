import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { falMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. fal has a synchronous image path
// (`POST https://fal.run/<model>`) and an async queue for video/audio
// (`POST https://queue.fal.run/<model>` → poll the `status_url`/`response_url` the submit
// response returns, which live under the two-segment app base, not the full model path).

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const KLING_MODEL = 'fal-ai/kling-video/v1.6/standard/text-to-video';
const KLING_POLL_BASE = 'https://queue.fal.run/fal-ai/kling-video';
const KLING_JOB_ID = `${KLING_MODEL}::req-1::${b64url(KLING_POLL_BASE)}`;

describe('fal media adapter (sync image + queued video)', () => {
  it('submits video to the queue endpoint with Key auth and routes prompt/input into the body', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ request_id: 'req-1', response_url: `${KLING_POLL_BASE}/requests/req-1` }),
    );
    const adapter: any = falMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'fal-key',
      model: KLING_MODEL,
      input: { duration: 5, aspect_ratio: '16:9' },
    });

    // job ids pin the submit response's poll base: `<model>::<request_id>::<base64url(base)>`.
    expect(sub.jobId).toBe(KLING_JOB_ID);
    const r = recs[0];
    expect(r.url).toBe('https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Key fal-key');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a cat surfing');
    expect(body.duration).toBe(5);
    expect(body.aspect_ratio).toBe('16:9');
  });

  it('submit without a response_url falls back to the two-segment app base', async () => {
    const { ctx } = makeCtx(() => res({ request_id: 'req-1' }));
    const adapter: any = falMediaModule.create(ctx as any);
    const sub = await adapter.generateVideo('a cat surfing', { apiKey: 'fal-key', model: KLING_MODEL });
    expect(sub.jobId).toBe(KLING_JOB_ID);
  });

  it('pollJob parses IN_PROGRESS → pending and COMPLETED → completed with the result artifact', async () => {
    const pendingCtx = makeCtx(() => res({ status: 'IN_PROGRESS' }));
    const pendingAdapter: any = falMediaModule.create(pendingCtx.ctx as any);
    const pending = await pendingAdapter.pollJob(KLING_JOB_ID, { apiKey: 'fal-key' });
    expect(pending.status).toBe('pending');
    expect(pendingCtx.recs[0].url).toBe(`${KLING_POLL_BASE}/requests/req-1/status`);

    const doneCtx = makeCtx((url) =>
      url.endsWith('/status')
        ? res({ status: 'COMPLETED' })
        : res({ video: { url: 'https://cdn.fal/out.mp4' } }),
    );
    const doneAdapter: any = falMediaModule.create(doneCtx.ctx as any);
    const done = await doneAdapter.pollJob(KLING_JOB_ID, { apiKey: 'fal-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.fal/out.mp4');
    expect(doneCtx.recs[1].url).toBe(`${KLING_POLL_BASE}/requests/req-1`);
  });

  it('pollJob on a legacy `<model>::<id>` job id derives the two-segment poll base', async () => {
    const { recs, ctx } = makeCtx(() => res({ status: 'IN_PROGRESS' }));
    const adapter: any = falMediaModule.create(ctx as any);
    const r = await adapter.pollJob(`${KLING_MODEL}::req-1`, { apiKey: 'fal-key' });
    expect(r.status).toBe('pending');
    expect(recs[0].url).toBe(`${KLING_POLL_BASE}/requests/req-1/status`);
  });

  it('pollJob ignores a tampered non-fal poll base in the job id (SSRF guard)', async () => {
    const { recs, ctx } = makeCtx(() => res({ status: 'IN_PROGRESS' }));
    const adapter: any = falMediaModule.create(ctx as any);
    const evil = `${KLING_MODEL}::req-1::${b64url('https://evil.example.com/steal')}`;
    const r = await adapter.pollJob(evil, { apiKey: 'fal-key' });
    expect(r.status).toBe('pending');
    expect(recs[0].url).toBe(`${KLING_POLL_BASE}/requests/req-1/status`);
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

  it('keeps the Pika video request shape unchanged', async () => {
    const pollBase = 'https://queue.fal.run/fal-ai/pika';
    const { recs, ctx } = makeCtx(() =>
      res({ request_id: 'pika-1', response_url: `${pollBase}/requests/pika-1` }),
    );
    const adapter: any = falMediaModule.create(ctx as any);
    await adapter.generateVideo('a dancing cat', {
      apiKey: 'fal-key',
      model: 'fal-ai/pika/v2.2/text-to-video',
      input: { negative_prompt: 'blurry', aspect_ratio: '16:9', resolution: '720p', duration: '5', seed: 7 },
    });
    expect(recs[0].url).toBe('https://queue.fal.run/fal-ai/pika/v2.2/text-to-video');
    expect(JSON.parse(recs[0].body)).toEqual({
      prompt: 'a dancing cat',
      negative_prompt: 'blurry',
      aspect_ratio: '16:9',
      resolution: '720p',
      duration: '5',
      seed: 7,
    });
  });

  it('submits Stable Audio and polls its audio_file artifact', async () => {
    const model = 'fal-ai/stable-audio';
    const pollBase = 'https://queue.fal.run/fal-ai/stable-audio';
    const submitCtx = makeCtx(() =>
      res({ request_id: 'audio-1', response_url: `${pollBase}/requests/audio-1` }),
    );
    const submitAdapter: any = falMediaModule.create(submitCtx.ctx as any);
    const submission = await submitAdapter.generateAudio('warm ambient piano', {
      apiKey: 'fal-key',
      model,
      input: { seconds_total: 30, cfg_scale: 7 },
    });
    expect(submitCtx.recs[0].url).toBe('https://queue.fal.run/fal-ai/stable-audio');
    expect(JSON.parse(submitCtx.recs[0].body)).toEqual({
      prompt: 'warm ambient piano',
      seconds_total: 30,
      cfg_scale: 7,
    });
    expect(submission.jobId).toBe(`${model}::audio-1::${b64url(pollBase)}`);

    const pollCtx = makeCtx((url) =>
      url.endsWith('/status')
        ? res({ status: 'COMPLETED' })
        : res({ audio_file: { url: 'https://cdn.fal/audio.wav' } }),
    );
    const pollAdapter: any = falMediaModule.create(pollCtx.ctx as any);
    const result = await pollAdapter.pollJob(submission.jobId, { apiKey: 'fal-key' });
    expect(result.status).toBe('completed');
    expect(result.artifactUrl).toBe('https://cdn.fal/audio.wav');
    expect(pollCtx.recs.map((rec) => rec.url)).toEqual([
      `${pollBase}/requests/audio-1/status`,
      `${pollBase}/requests/audio-1`,
    ]);
  });
});

describe('fal media adapter testConnection', () => {
  it('GETs the platform model catalog with Key auth — 200 ok, 401 Invalid API key, 500 throws, missing key', async () => {
    const okCtx = makeCtx(() => res({ models: [] }));
    const a1: any = falMediaModule.create(okCtx.ctx as any);
    expect(await a1.testConnection({ apiKey: 'fal-key' })).toEqual({ ok: true, message: 'Connection successful' });
    expect(okCtx.recs[0].url).toBe('https://api.fal.ai/v1/models');
    expect(okCtx.recs[0].method).toBe('GET');
    expect(okCtx.recs[0].headers.Authorization).toBe('Key fal-key');

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a2: any = falMediaModule.create(bad.ctx as any);
    expect(await a2.testConnection({ apiKey: 'wrong' })).toEqual({ ok: false, message: 'Invalid API key' });

    const err = makeCtx(() => res('boom', false, 500));
    const a3: any = falMediaModule.create(err.ctx as any);
    await expect(a3.testConnection({ apiKey: 'fal-key' })).rejects.toThrow(/connection test failed \(500\)/);

    const noKey = makeCtx(() => res({}));
    const a4: any = falMediaModule.create(noKey.ctx as any);
    expect(await a4.testConnection({})).toEqual({ ok: false, message: 'fal.ai API key is required' });
    expect(noKey.recs).toHaveLength(0);
  });
});
