import { describe, it, expect } from 'vitest';
import { higgsfieldMediaModule } from './media.adapter';

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

describe('higgsfield media adapter (submit-and-poll, two-part key)', () => {
  it('submits DoP image-to-video with the "Authorization: Key id:secret" header and nested input_images', async () => {
    const { recs, ctx } = makeCtx(() => res({ request_id: 'req-9', status: 'queued' }));
    const adapter: any = higgsfieldMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('make it move', {
      credentials: { keyId: 'KID', keySecret: 'SEC' },
      model: 'dop-standard',
      input: { image_url: 'https://files/x.png', motion: 'pan' },
    });

    expect(sub.jobId).toBe('req-9');
    const r = recs[0];
    expect(r.url).toBe('https://platform.higgsfield.ai/v1/image2video/dop');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Key KID:SEC');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('dop-standard');
    expect(body.prompt).toBe('make it move');
    expect(body.input_images).toEqual([{ type: 'image_url', image_url: 'https://files/x.png' }]);
    expect(body.motion).toBe('pan');
  });

  it('pollJob parses in_progress → pending and completed → video.url artifact', async () => {
    const { ctx } = makeCtx((_u, _i, n) =>
      n === 1
        ? res({ status: 'in_progress' })
        : res({ status: 'completed', video: { url: 'https://hf/out.mp4' } }),
    );
    const adapter: any = higgsfieldMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('req-9', { credentials: { keyId: 'KID', keySecret: 'SEC' } });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('req-9', { credentials: { keyId: 'KID', keySecret: 'SEC' } });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://hf/out.mp4');
  });

  it('accepts a combined "id:secret" apiKey fallback and submits Soul text-to-image', async () => {
    const { recs, ctx } = makeCtx((_u, _i, n) =>
      n === 1
        ? res({ request_id: 'img-1' })
        : res({ status: 'completed', images: [{ url: 'https://hf/a.png' }] }),
    );
    const adapter: any = higgsfieldMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a castle', { apiKey: 'KID:SEC' });
    expect(recs[0].url).toBe('https://platform.higgsfield.ai/v1/text2image/soul');
    expect(recs[0].headers.Authorization).toBe('Key KID:SEC');
    expect(out.image).toBe('https://hf/a.png');
  }, 15000);

  it('reports nsfw poll status as failed', async () => {
    const { ctx } = makeCtx(() => res({ status: 'nsfw' }));
    const adapter: any = higgsfieldMediaModule.create(ctx as any);
    const out = await adapter.pollJob('req-9', { credentials: { keyId: 'KID', keySecret: 'SEC' } });
    expect(out.status).toBe('failed');
  });

  it('2.1: a 503 on poll THROWS (transient); missing creds on poll → terminal failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = higgsfieldMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('req-9', { credentials: { keyId: 'KID', keySecret: 'SEC' } })).rejects.toThrow(/transient/i);

    const nokey = makeCtx(() => res({}));
    const a2: any = higgsfieldMediaModule.create(nokey.ctx as any);
    const r = await a2.pollJob('req-9', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Key ID and Key Secret/);
  });

  it('5.6: testConnection rejects a wrong keySecret (403) and a 5xx as NOT connected', async () => {
    const forbidden = makeCtx(() => res('forbidden', false, 403));
    const a1: any = higgsfieldMediaModule.create(forbidden.ctx as any);
    expect((await a1.testConnection({ credentials: { keyId: 'KID', keySecret: 'WRONG' } })).ok).toBe(false);

    const down = makeCtx(() => res('down', false, 500));
    const a2: any = higgsfieldMediaModule.create(down.ctx as any);
    expect((await a2.testConnection({ credentials: { keyId: 'KID', keySecret: 'SEC' } })).ok).toBe(false);
  });

  it('5.12: a combined "id:secret" with a colon IN the secret is not truncated', async () => {
    const { recs, ctx } = makeCtx(() => res('', true, 404));
    const adapter: any = higgsfieldMediaModule.create(ctx as any);
    await adapter.testConnection({ apiKey: 'KID:sec:with:colons' });
    expect(recs[0].headers.Authorization).toBe('Key KID:sec:with:colons');
  });

  it('testConnection ok, and missing credentials throw', async () => {
    const { ctx } = makeCtx(() => res('', true, 404));
    const adapter: any = higgsfieldMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ credentials: { keyId: 'KID', keySecret: 'SEC' } });
    expect(tc.ok).toBe(true);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow();
    await expect(adapter.generateAudio('x', { credentials: { keyId: 'a', keySecret: 'b' } })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { credentials: { keyId: 'a', keySecret: 'b' } })).rejects.toThrow();
  });

  // 6.1h — a Soul batch surfaces extra takes via the generic extraArtifactUrls (Suno pattern).
  it('pollJob returns extra image takes as extraArtifactUrls', async () => {
    const { ctx } = makeCtx(() =>
      res({
        status: 'completed',
        images: [{ url: 'https://cdn.hf/1.png' }, { url: 'https://cdn.hf/2.png' }, { url: 'https://cdn.hf/3.png' }],
      }),
    );
    const adapter: any = higgsfieldMediaModule.create(ctx as any);
    const out = await adapter.pollJob('req-1', { credentials: { keyId: 'a', keySecret: 'b' } });
    expect(out.status).toBe('completed');
    expect(out.artifactUrl).toBe('https://cdn.hf/1.png');
    expect(out.extraArtifactUrls).toEqual(['https://cdn.hf/2.png', 'https://cdn.hf/3.png']);
    expect(out.metadata?.source).toBeUndefined();
  });

  it('pollJob throws on a transient 503 and returns failed on missing creds', async () => {
    const { ctx: t } = makeCtx(() => res('down', false, 503));
    await expect(
      (higgsfieldMediaModule.create(t as any) as any).pollJob('req-1', { credentials: { keyId: 'a', keySecret: 'b' } }),
    ).rejects.toThrow(/transient/);
    const { ctx: noKey } = makeCtx(() => res({}));
    const failed = await (higgsfieldMediaModule.create(noKey as any) as any).pollJob('req-1', {});
    expect(failed.status).toBe('failed');
  });
});
