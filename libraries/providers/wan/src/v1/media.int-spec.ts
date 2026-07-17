import { describe, it, expect } from 'vitest';
import { wanMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. A stub ctx.fetch records the
// request the adapter builds and returns canned responses matching DashScope's documented shape.

interface Rec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function makeCtx(handler: (url: string, init: any, n: number) => any) {
  const recs: Rec[] = [];
  const fetch = async (input: any, init: any = {}) => {
    recs.push({
      url: String(input),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    });
    return handler(String(input), init, recs.length);
  };
  return {
    recs,
    ctx: {
      credentials: {},
      encryption: { encrypt: (v: string) => v, decrypt: (v: string) => v },
      fetch: fetch as any,
      logger: { log() {}, warn() {}, error() {}, debug() {} },
      telemetry: { recordCall() {} },
    },
  };
}

const res = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('wan media adapter (DashScope async task API)', () => {
  it('submits video generation to the documented endpoint with the X-DashScope-Async header and {model,input,parameters} body', async () => {
    const { recs, ctx } = makeCtx(() => res({ output: { task_id: 'task-123' } }));
    const adapter: any = wanMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'wan-key',
      model: 'wan2.2-t2v-plus',
      input: { negative_prompt: 'blurry', resolution: '1080P' },
    });

    expect(sub.jobId).toBe('task-123');
    const r = recs[0];
    expect(r.url).toBe(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    );
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer wan-key');
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
        : res({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.wan/out.mp4' } }),
    );
    const adapter: any = wanMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('task-123', { apiKey: 'wan-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('task-123', { apiKey: 'wan-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.wan/out.mp4');
  });

  it('generateImage routes prompt into input and bounded-polls to completed (results[].url)', async () => {
    const { recs, ctx } = makeCtx((url, _i, n) => {
      if (url.endsWith('/image-synthesis')) return res({ output: { task_id: 'img-1' } });
      return res({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://cdn.wan/img.png' }] } });
    });
    const adapter: any = wanMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a sunset', { apiKey: 'wan-key', model: 'wan2.2-t2i-flash' });
    expect(recs[0].url).toBe('https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis');
    expect(out.image).toBe('https://cdn.wan/img.png');
  }, 15000);

  it('testConnection succeeds against the OpenAI-compatible models list', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = wanMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'wan-key' });
    expect(tc.ok).toBe(true);
    expect(recs[0].url).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models');
  });

  it('2.1: a 503 on poll THROWS (transient); a FAILED task_status → returned failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = wanMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('task-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const f = makeCtx(() => res({ output: { task_status: 'FAILED', message: 'nope' } }));
    const a2: any = wanMediaModule.create(f.ctx as any);
    expect((await a2.pollJob('task-1', { apiKey: 'k' })).status).toBe('failed');
  });

  it('2.1: a 4xx on poll → returned failed; missing key on poll → terminal failed', async () => {
    const four = makeCtx(() => res('bad', false, 400));
    const a1: any = wanMediaModule.create(four.ctx as any);
    expect((await a1.pollJob('task-1', { apiKey: 'k' })).status).toBe('failed');

    const nokey = makeCtx(() => res({}));
    const a2: any = wanMediaModule.create(nokey.ctx as any);
    const r = await a2.pollJob('task-1', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/key is required/);
  });

  it('rejects unsupported audio/avatar and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = wanMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
  });
});
