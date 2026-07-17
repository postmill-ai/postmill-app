import { describe, it, expect } from 'vitest';
import { reelfarmMediaModule } from './media.adapter';

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

describe('reelfarm media adapter (slideshow generate → status → video)', () => {
  it('submits the slideshow with additional_context and a 0-indexed images array', async () => {
    const { recs, ctx } = makeCtx(() => res({ slideshow_id: 4567, status: 'draft' }));
    const adapter: any = reelfarmMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('top 5 travel hacks', {
      apiKey: 'rf-key',
      input: { image_1: 'https://files/a.png', image_2: 'https://files/b.png' },
    });

    expect(sub.jobId).toBe('4567');
    const r = recs[0];
    expect(r.url).toBe('https://reel.farm/api/v1/slideshows/generate');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer rf-key');
    const body = JSON.parse(r.body);
    expect(body.additional_context).toBe('top 5 travel hacks');
    expect(body.images).toEqual(['https://files/a.png', 'https://files/b.png']);
  });

  it('pollJob stays pending until a video_id exists, then fetches /videos/{id} for video_url', async () => {
    // 1st poll: status without video_id → pending (single status call).
    // 2nd poll: status with video_id → then a /videos/{id} call returning video_url.
    const { recs, ctx } = makeCtx((url, _i, _n) => {
      if (url.includes('/videos/')) return res({ video_id: 'vid-1', video_url: 'https://rf/out.mp4', finished: true });
      // status endpoint
      return recs.filter((r) => r.url.includes('/status')).length === 1
        ? res({ status: 'rendering' })
        : res({ status: 'completed', video_id: 'vid-1' });
    });
    const adapter: any = reelfarmMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('4567', { apiKey: 'rf-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('4567', { apiKey: 'rf-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://rf/out.mp4');
    expect(recs.some((r) => r.url === 'https://reel.farm/api/v1/videos/vid-1')).toBe(true);
  });

  it('testConnection ok; image/audio/avatar and missing key/prompt throw', async () => {
    const { ctx } = makeCtx(() => res('', true, 404));
    const adapter: any = reelfarmMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'rf-key' });
    expect(tc.ok).toBe(true);
    await expect(adapter.generateImage('x', { apiKey: 'rf-key' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'rf-key' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'rf-key' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateVideo('', { apiKey: 'rf-key' })).rejects.toThrow('requires a prompt');
  });
});
