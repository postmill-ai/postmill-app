import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { qwenMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Qwen (Alibaba DashScope) is the
// async task API: POST with `X-DashScope-Async: enable` → task_id, poll GET /tasks/{id}.
// Image keeps the synchronous contract via bounded internal polling; video is submit + poll.

describe('qwen media adapter (DashScope async task API)', () => {
  it('submits video generation to the documented endpoint with the X-DashScope-Async header and {model,input,parameters} body', async () => {
    const { recs, ctx } = makeCtx(() => res({ output: { task_id: 'task-123' } }));
    const adapter: any = qwenMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'qwen-key',
      model: 'wan2.2-t2v-plus',
      input: { negative_prompt: 'blurry', resolution: '1080P' },
    });

    expect(sub.jobId).toBe('task-123');
    const r = recs[0];
    expect(r.url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    );
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer qwen-key');
    expect(r.headers['X-DashScope-Async']).toBe('enable');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('wan2.2-t2v-plus');
    // negative_prompt is routed into `input`; everything else into `parameters`.
    expect(body.input).toEqual({ prompt: 'a cat surfing', negative_prompt: 'blurry' });
    expect(body.parameters).toEqual({ resolution: '1080P' });
  });

  it('pollJob parses RUNNING → pending and SUCCEEDED → completed with the video_url artifact', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ output: { task_status: 'RUNNING' } })
        : res({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.qwen/out.mp4' } }),
    );
    const adapter: any = qwenMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('task-123', { apiKey: 'qwen-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('task-123', { apiKey: 'qwen-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.qwen/out.mp4');
  });

  it('generateImage routes prompt into input and bounded-polls to completed (results[].url)', async () => {
    const { recs, ctx } = makeCtx((url) => {
      if (url.endsWith('/image-synthesis')) return res({ output: { task_id: 'img-1' } });
      return res({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://cdn.qwen/img.png' }] } });
    });
    const adapter: any = qwenMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a sunset', { apiKey: 'qwen-key', model: 'qwen-image-plus' });
    expect(recs[0].url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    );
    expect(out.image).toBe('https://cdn.qwen/img.png');
  }, 15000);

  it('2.1: a 503 on poll THROWS (transient); a FAILED task_status → returned failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = qwenMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('task-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const f = makeCtx(() => res({ output: { task_status: 'FAILED', message: 'nope' } }));
    const a2: any = qwenMediaModule.create(f.ctx as any);
    expect((await a2.pollJob('task-1', { apiKey: 'k' })).status).toBe('failed');
  });

  it('2.1: a 4xx on poll → returned failed; missing key on poll → terminal failed', async () => {
    const four = makeCtx(() => res('bad', false, 400));
    const a1: any = qwenMediaModule.create(four.ctx as any);
    expect((await a1.pollJob('task-1', { apiKey: 'k' })).status).toBe('failed');

    const nokey = makeCtx(() => res({}));
    const a2: any = qwenMediaModule.create(nokey.ctx as any);
    const r = await a2.pollJob('task-1', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/key is required/);
  });

  it('rejects unsupported audio/avatar and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = qwenMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
  });
});
