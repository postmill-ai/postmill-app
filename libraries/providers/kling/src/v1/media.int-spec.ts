import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { klingMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Kling AI's official API runs two
// standards at once: video is the new path-per-model standard (POST /text-to-video|image-to-video/<model>,
// unified poll GET /tasks?task_ids=), image is the legacy /v1 standard (POST /v1/images/generations,
// poll GET /v1/images/generations/{id}). Every response is a {code, message, data} envelope —
// code !== 0 is an error even on HTTP 200.

describe('kling media adapter (official Kling AI API)', () => {
  it('submits text-to-video to /text-to-video/<model> with Bearer auth and a settings block', async () => {
    const { recs, ctx } = makeCtx(() => res({ code: 0, message: '', data: { id: '930000000000000001', status: 'submitted' } }));
    const adapter: any = klingMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a lighthouse at dusk', {
      apiKey: 'kling-key',
      model: 'kling-2.6',
      webhookUrl: 'https://postmill.example/webhooks/kling',
      input: { duration: '10', aspect_ratio: '9:16', resolution: '1080p', audio: 'native', negative_prompt: 'ignored' },
    });

    expect(sub.jobId).toBe('t2v::930000000000000001');
    const r = recs[0];
    expect(r.url).toBe('https://api-singapore.klingai.com/text-to-video/kling-2.6');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer kling-key');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a lighthouse at dusk');
    // duration arrives as a descriptor string and must go out as the API's int; the new
    // standard has no negative_prompt — it must not leak into the body.
    expect(body.settings).toEqual({ duration: 10, aspect_ratio: '9:16', resolution: '1080p', audio: 'native' });
    expect(body.negative_prompt).toBeUndefined();
    expect(body.options).toEqual({ callback_url: 'https://postmill.example/webhooks/kling' });
  });

  it('rejects Kling 2.6 native audio below 1080p before submitting a billed job', async () => {
    const { recs, ctx } = makeCtx(() => res({ code: 0, data: { id: 'should-not-run' } }));
    const adapter: any = klingMediaModule.create(ctx as any);

    for (const resolution of ['720p', undefined]) {
      await expect(adapter.generateVideo('coffee pouring', {
        apiKey: 'kling-key',
        model: 'kling-2.6',
        input: { resolution, audio: 'native' },
      })).rejects.toThrow('Kling 2.6 native audio requires 1080p resolution');
    }
    expect(recs).toHaveLength(0);

    await adapter.generateVideo('coffee pouring', {
      apiKey: 'kling-key',
      model: 'kling-2.6',
      input: { resolution: '720p', audio: 'off' },
    });
    expect(JSON.parse(recs[0].body).settings).toEqual({ resolution: '720p', audio: 'off' });
  });

  it('submits image-to-video to /image-to-video/<model> with contents[] frames and no aspect_ratio', async () => {
    const { recs, ctx } = makeCtx(() => res({ code: 0, message: '', data: { id: 'task-i2v-1' } }));
    const adapter: any = klingMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('she turns and waves', {
      apiKey: 'kling-key',
      model: 'kling-3.0-turbo',
      input: { image: 'https://cdn.example/first.png', image_tail: 'https://cdn.example/last.png', duration: '5', aspect_ratio: '16:9', audio: 'native' },
    });

    expect(sub.jobId).toBe('i2v::task-i2v-1');
    const r = recs[0];
    expect(r.url).toBe('https://api-singapore.klingai.com/image-to-video/kling-3.0-turbo');
    const body = JSON.parse(r.body);
    expect(body.contents).toEqual([
      { type: 'prompt', text: 'she turns and waves' },
      { type: 'first_frame', url: 'https://cdn.example/first.png' },
      { type: 'last_frame', url: 'https://cdn.example/last.png' },
    ]);
    // i2v has no aspect_ratio (the frame decides), and kling-3.0-turbo has no audio field
    // (native audio is always on) — both must be dropped.
    expect(body.settings).toEqual({ duration: 5 });
  });

  it('throws an attributed error carrying the vendor message when the envelope code is non-zero', async () => {
    const { ctx } = makeCtx(() => res({ code: 1102, message: 'balance not enough', data: null }));
    const adapter: any = klingMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow(/balance not enough/);
  });

  it('rejects an injected model id before it reaches the request path', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = klingMediaModule.create(ctx as any);
    await expect(
      adapter.generateVideo('x', { apiKey: 'k', model: 'kling-2.6?callback_url=https://evil' }),
    ).rejects.toThrow(/Invalid model id/);
  });

  it('pollJob hits the unified /tasks query and maps processing → pending, succeeded → artifact', async () => {
    const { recs, ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ code: 0, data: [{ id: 'task-1', status: 'processing' }] })
        : res({ code: 0, data: [{ id: 'task-1', status: 'succeeded', outputs: [{ type: 'video', url: 'https://cdn.kling/out.mp4' }] }] }),
    );
    const adapter: any = klingMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('t2v::task-1', { apiKey: 'kling-key' });
    expect(pending.status).toBe('pending');
    expect(recs[0].url).toBe('https://api-singapore.klingai.com/tasks?task_ids=task-1');
    expect(recs[0].headers.Authorization).toBe('Bearer kling-key');

    const done = await adapter.pollJob('t2v::task-1', { apiKey: 'kling-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.kling/out.mp4');
  });

  it('pollJob treats a failed task and a failure envelope as terminal, and an absent record as pending', async () => {
    const failed = makeCtx(() => res({ code: 0, data: [{ id: 'task-1', status: 'failed', message: 'content risk control' }] }));
    const a1: any = klingMediaModule.create(failed.ctx as any);
    const rf = await a1.pollJob('i2v::task-1', { apiKey: 'k' });
    expect(rf.status).toBe('failed');
    expect(rf.error).toMatch(/content risk control/);

    const envelope = makeCtx(() => res({ code: 1201, message: 'Task not found' }));
    const a2: any = klingMediaModule.create(envelope.ctx as any);
    expect((await a2.pollJob('t2v::task-1', { apiKey: 'k' })).status).toBe('failed');

    // 200 + empty data = the vendor cannot see the id yet (reads can lag the create).
    const absent = makeCtx(() => res({ code: 0, data: [] }));
    const a3: any = klingMediaModule.create(absent.ctx as any);
    expect((await a3.pollJob('t2v::task-1', { apiKey: 'k' })).status).toBe('pending');
  });

  it('2.1: a 429/5xx poll THROWS (transient); a transient vendor code in a 200 envelope also throws', async () => {
    const t = makeCtx(() => res('busy', false, 429));
    const a1: any = klingMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('t2v::task-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const t5 = makeCtx(() => res('oops', false, 503));
    const a2: any = klingMediaModule.create(t5.ctx as any);
    await expect(a2.pollJob('t2v::task-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const code = makeCtx(() => res({ code: 1302, message: 'system busy' }));
    const a3: any = klingMediaModule.create(code.ctx as any);
    await expect(a3.pollJob('t2v::task-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);
  });

  it('pollJob fails terminally on a legacy/un-namespaced job id or a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = klingMediaModule.create(ctx as any);

    const legacy = await adapter.pollJob('930000000000000001', { apiKey: 'k' });
    expect(legacy.status).toBe('failed');
    expect(legacy.error).toMatch(/legacy job id/);

    const noKey = await adapter.pollJob('t2v::task-1', {});
    expect(noKey.status).toBe('failed');
    expect(noKey.error).toMatch(/key is required/);
  });

  it('generateImage posts model_name to /v1/images/generations and bounded-polls to succeed', async () => {
    const { recs, ctx } = makeCtx((url, init) => {
      if (init.method === 'POST') return res({ code: 0, data: { task_id: 'img-1', task_status: 'submitted' } });
      return res({
        code: 0,
        data: {
          task_id: 'img-1',
          task_status: 'succeed',
          task_result: { images: [{ url: 'https://cdn.kling/a.png' }, { url: 'https://cdn.kling/b.png' }] },
        },
      });
    });
    const adapter: any = klingMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a ceramic lighthouse', {
      apiKey: 'kling-key',
      model: 'kling-v3',
      input: { negative_prompt: 'blurry', aspect_ratio: '1:1', resolution: '2k', n: 2 },
    });

    const submit = JSON.parse(recs[0].body);
    expect(recs[0].url).toBe('https://api-singapore.klingai.com/v1/images/generations');
    expect(submit).toEqual({ model_name: 'kling-v3', prompt: 'a ceramic lighthouse', negative_prompt: 'blurry', aspect_ratio: '1:1', resolution: '2k', n: 2 });
    expect(recs[1].url).toBe('https://api-singapore.klingai.com/v1/images/generations/img-1');
    expect(out.image).toBe('https://cdn.kling/a.png');
    expect(out.images).toEqual(['https://cdn.kling/a.png', 'https://cdn.kling/b.png']);
    expect(out.multi).toBe(true);
  }, 15000);

  it('generateImage routes a source image into the native `image` field and drops negative_prompt (i2i contract)', async () => {
    const { recs, ctx } = makeCtx((url, init) => {
      if (init.method === 'POST') return res({ code: 0, data: { task_id: 'img-2', task_status: 'submitted' } });
      return res({ code: 0, data: { task_id: 'img-2', task_status: 'succeed', task_result: { images: [{ url: 'https://cdn.kling/i2i.png' }] } } });
    });
    const adapter: any = klingMediaModule.create(ctx as any);

    const out = await adapter.generateImage('same dog, pixar style', {
      apiKey: 'k',
      sourceUrl: 'https://cdn.example/dog.png',
      input: { negative_prompt: 'blurry' },
    });
    const submit = JSON.parse(recs[0].body);
    expect(submit.image).toBe('https://cdn.example/dog.png');
    expect(submit.negative_prompt).toBeUndefined();
    expect(out.image).toBe('https://cdn.kling/i2i.png');
  }, 15000);

  it('generateImage throws the attributed failure on a terminal failed task', async () => {
    const { ctx } = makeCtx((url, init) => {
      if (init.method === 'POST') return res({ code: 0, data: { task_id: 'img-3', task_status: 'submitted' } });
      return res({ code: 0, data: { task_id: 'img-3', task_status: 'failed', task_status_msg: 'risk control' } });
    });
    const adapter: any = klingMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow(/risk control/);
  }, 15000);

  it('testConnection uses the free task-list endpoint; 200+code 0 ok, 401 rejected', async () => {
    const ok = makeCtx(() => res({ code: 0, data: [] }));
    const a1: any = klingMediaModule.create(ok.ctx as any);
    expect(await a1.testConnection({ apiKey: 'k' })).toEqual({ ok: true, message: 'Connection successful' });
    expect(ok.recs[0].url).toBe('https://api-singapore.klingai.com/v1/images/generations?pageNum=1&pageSize=1');
    expect(ok.recs[0].method).toBe('GET');

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a2: any = klingMediaModule.create(bad.ctx as any);
    const r = await a2.testConnection({ apiKey: 'wrong' });
    expect(r.ok).toBe(false);
  });

  it('rejects unsupported audio/avatar and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = klingMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow(/does not support audio/);
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow(/does not support avatar/);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('Kling AI API key is required');
    await expect(adapter.generateImage('x', {})).rejects.toThrow('Kling AI API key is required');
  });
});
