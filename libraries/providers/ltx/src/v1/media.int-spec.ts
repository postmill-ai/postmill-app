import { describe, it, expect } from 'vitest';
import { ltxMediaModule } from './media.adapter';

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

describe('ltx media adapter (op-routed submit-and-poll, namespaced job id)', () => {
  it('routes to image-to-video when an image_uri is present and namespaces the job id <op>:<id>', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'abc' }));
    const adapter: any = ltxMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('pan across the city', {
      apiKey: 'ltx-key',
      model: 'ltx-2-3-pro',
      input: { image_uri: 'https://files/frame.png', resolution: '1080p' },
    });

    expect(sub.jobId).toBe('image-to-video:abc');
    const r = recs[0];
    expect(r.url).toBe('https://api.ltx.video/v2/image-to-video');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer ltx-key');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('ltx-2-3-pro');
    expect(body.prompt).toBe('pan across the city');
    expect(body.image_uri).toBe('https://files/frame.png');
    expect(body.resolution).toBe('1080p');
  });

  it('pollJob splits the namespaced id to hit /v2/<op>/<id> and parses result.video_url', async () => {
    const { recs, ctx } = makeCtx((_u, _i, n) =>
      n === 1
        ? res({ status: 'processing' })
        : res({ status: 'completed', result: { video_url: 'https://ltx/out.mp4' } }),
    );
    const adapter: any = ltxMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('image-to-video:abc', { apiKey: 'ltx-key' });
    expect(pending.status).toBe('pending');
    expect(recs[0].url).toBe('https://api.ltx.video/v2/image-to-video/abc');

    const done = await adapter.pollJob('image-to-video:abc', { apiKey: 'ltx-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://ltx/out.mp4');
  });

  it('routes to audio-to-video and text-to-video by inputs present', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'z' }));
    const adapter: any = ltxMediaModule.create(ctx as any);
    await adapter.generateVideo('p', { apiKey: 'k', input: { audio_uri: 'https://f/a.mp3' } });
    expect(recs[0].url).toBe('https://api.ltx.video/v2/audio-to-video');
    await adapter.generateVideo('p', { apiKey: 'k' });
    expect(recs[1].url).toBe('https://api.ltx.video/v2/text-to-video');
  });

  it('2.1: a 503 on poll THROWS (transient); a provider status:failed → returned failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = ltxMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('text-to-video:abc', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const f = makeCtx(() => res({ status: 'failed', error: 'nope' }));
    const a2: any = ltxMediaModule.create(f.ctx as any);
    const r = await a2.pollJob('text-to-video:abc', { apiKey: 'k' });
    expect(r.status).toBe('failed');
  });

  it('2.1: a 4xx on poll → returned failed; missing key on poll → terminal failed', async () => {
    const four = makeCtx(() => res('bad', false, 422));
    const a1: any = ltxMediaModule.create(four.ctx as any);
    expect((await a1.pollJob('text-to-video:abc', { apiKey: 'k' })).status).toBe('failed');

    const nokey = makeCtx(() => res({}));
    const a2: any = ltxMediaModule.create(nokey.ctx as any);
    const r = await a2.pollJob('text-to-video:abc', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/key is required/);
  });

  it('5.11: an unknown prefix is treated as a bare text-to-video id (full id in path)', async () => {
    const { recs, ctx } = makeCtx(() => res({ status: 'processing' }));
    const adapter: any = ltxMediaModule.create(ctx as any);
    await adapter.pollJob('weird:abc', { apiKey: 'k' });
    expect(recs[0].url).toBe('https://api.ltx.video/v2/text-to-video/weird:abc');
  });

  it('5.6: testConnection rejects a 5xx as NOT connected', async () => {
    const { ctx } = makeCtx(() => res('down', false, 500));
    const adapter: any = ltxMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'k' });
    expect(tc.ok).toBe(false);
  });

  it('testConnection ok; image and unsupported ops throw', async () => {
    const { ctx } = makeCtx(() => res('', true, 404));
    const adapter: any = ltxMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'k' });
    expect(tc.ok).toBe(true);
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
  });
});
