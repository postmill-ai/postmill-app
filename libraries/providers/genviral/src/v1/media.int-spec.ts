import { describe, it, expect } from 'vitest';
import { genviralMediaModule } from './media.adapter';

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

describe('genviral media adapter (studio videos envelope)', () => {
  it('submits with model_id, nests param fields under params, and reads data.video_id', async () => {
    const { recs, ctx } = makeCtx(() => res({ ok: true, data: { video_id: 'gv-1', status: 'processing' } }));
    const adapter: any = genviralMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a product demo', {
      apiKey: 'gv-key',
      model: 'seedance-1',
      input: { resolution: '1080p', duration_seconds: 8, voice_id: 'nova' },
    });

    expect(sub.jobId).toBe('gv-1');
    const r = recs[0];
    expect(r.url).toBe('https://www.genviral.io/api/partner/v1/studio/videos');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer gv-key');
    const body = JSON.parse(r.body);
    expect(body.model_id).toBe('seedance-1');
    expect(body.prompt).toBe('a product demo');
    // resolution/duration_seconds nested under params; voice_id rides top-level.
    expect(body.params).toEqual({ resolution: '1080p', duration_seconds: 8 });
    expect(body.voice_id).toBe('nova');
  });

  it('pollJob parses processing → pending and succeeded → data.output_url', async () => {
    const { ctx } = makeCtx((_u, _i, n) =>
      n === 1
        ? res({ ok: true, data: { status: 'processing' } })
        : res({ ok: true, data: { status: 'succeeded', output_url: 'https://gv/out.mp4' } }),
    );
    const adapter: any = genviralMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('gv-1', { apiKey: 'gv-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('gv-1', { apiKey: 'gv-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://gv/out.mp4');
  });

  it('listModels maps the /studio/models catalog (video only) tolerating id/name variants', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ data: [{ model_id: 'seedance-1', name: 'Seedance' }, 'sora-2'] }),
    );
    const adapter: any = genviralMediaModule.create(ctx as any);
    const models = await adapter.listModels('video', { apiKey: 'gv-key' });
    expect(recs[0].url).toBe('https://www.genviral.io/api/partner/v1/studio/models');
    expect(models).toEqual([
      { id: 'seedance-1', label: 'Seedance' },
      { id: 'sora-2', label: 'sora-2' },
    ]);
    const none = await adapter.listModels('image', { apiKey: 'gv-key' });
    expect(none).toEqual([]);
  });

  it('testConnection ok; image/audio/avatar and missing key/model throw', async () => {
    const { ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = genviralMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'gv-key' });
    expect(tc.ok).toBe(true);
    await expect(adapter.generateImage('x', { apiKey: 'gv-key' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'gv-key' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'gv-key' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'gv-key' })).rejects.toThrow('requires a model');
  });

  // 6.1g — a 200 body with `ok:false` is a terminal application error, surfaced as failure.
  it('generateVideo throws on an ok:false envelope', async () => {
    const { ctx } = makeCtx(() => res({ ok: false, message: 'quota exceeded' }));
    const adapter: any = genviralMediaModule.create(ctx as any);
    await expect(
      adapter.generateVideo('a clip', { apiKey: 'gv-key', model: 'seedance-1' }),
    ).rejects.toThrow(/quota exceeded/);
  });

  it('pollJob: ok:false → failed, 503 → throws, 400 → failed, missing key → failed', async () => {
    const { ctx: okFalse } = makeCtx(() => res({ ok: false, message: 'boom' }));
    const f1 = await (genviralMediaModule.create(okFalse as any) as any).pollJob('v1', { apiKey: 'gv-key' });
    expect(f1.status).toBe('failed');

    const { ctx: t } = makeCtx(() => res('down', false, 503));
    await expect(
      (genviralMediaModule.create(t as any) as any).pollJob('v1', { apiKey: 'gv-key' }),
    ).rejects.toThrow(/transient/);

    const { ctx: bad } = makeCtx(() => res('bad', false, 400));
    const f2 = await (genviralMediaModule.create(bad as any) as any).pollJob('v1', { apiKey: 'gv-key' });
    expect(f2.status).toBe('failed');

    const { ctx: noKey } = makeCtx(() => res({}));
    const f3 = await (genviralMediaModule.create(noKey as any) as any).pollJob('v1', {});
    expect(f3.status).toBe('failed');
  });
});
