import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { lumaMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. A stub ctx.fetch records the
// request the adapter builds and returns canned responses matching Luma Dream Machine's
// documented shape. Luma is an async submit-and-poll video provider.

describe('luma media adapter (async video submit-and-poll)', () => {
  it('POSTs to /generations with Bearer auth, routes prompt/model into the body, and folds start_image_url into keyframes', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'gen-123' }));
    const adapter: any = lumaMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'luma-key',
      model: 'ray-2',
      input: { start_image_url: 'https://cdn.example/start.png', resolution: '720p' },
    });

    expect(sub.jobId).toBe('gen-123');
    const r = recs[0];
    expect(r.url).toBe('https://api.lumalabs.ai/dream-machine/v1/generations');
    expect(r.method).toBe('POST');
    expect(r.headers.authorization).toBe('Bearer luma-key');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a cat surfing');
    expect(body.model).toBe('ray-2');
    expect(body.resolution).toBe('720p');
    expect(body.keyframes).toEqual({ frame0: { type: 'image', url: 'https://cdn.example/start.png' } });
  });

  it('pollJob parses state dreaming → pending and completed → completed with the assets.video artifact', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ state: 'dreaming' })
        : res({ state: 'completed', assets: { video: 'https://cdn.luma/out.mp4' } }),
    );
    const adapter: any = lumaMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('gen-123', { apiKey: 'luma-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('gen-123', { apiKey: 'luma-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.luma/out.mp4');
  });

  it('rejects a missing key and unsupported image/audio/avatar operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = lumaMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('Luma API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });

  // 3.4 — transient poll = retry (throw); terminal 4xx = failed; missing key = failed (not throw).
  it('pollJob throws on a 502 and returns failed on a 404', async () => {
    const { ctx: ctx5 } = makeCtx(() => res('bad gateway', false, 502));
    await expect(
      (lumaMediaModule.create(ctx5 as any) as any).pollJob('gen-1', { apiKey: 'luma-key' }),
    ).rejects.toThrow(/transient/);

    const { ctx: ctx4 } = makeCtx(() => res('gone', false, 404));
    const out = await (lumaMediaModule.create(ctx4 as any) as any).pollJob('gen-1', { apiKey: 'luma-key' });
    expect(out.status).toBe('failed');

    const { ctx: ctxNoKey } = makeCtx(() => res({}));
    const noKey = await (lumaMediaModule.create(ctxNoKey as any) as any).pollJob('gen-1', {});
    expect(noKey.status).toBe('failed');
  });
});
