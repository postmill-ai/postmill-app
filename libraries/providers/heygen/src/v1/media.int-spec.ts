import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { heygenMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. A stub ctx.fetch records the
// request the adapter builds and returns canned responses matching HeyGen's documented shape.
// HeyGen is async submit-and-poll; pollJob is operation-namespaced (`<op>:<id>`), a bare id
// being an avatar-video job.

describe('heygen media adapter (async avatar-video submit-and-poll)', () => {
  it('POSTs avatar video to /v2/video/generate with the x-api-key header and the video_inputs body', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: { video_id: 'vid-123' } }));
    const adapter: any = heygenMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('hello there', {
      apiKey: 'heygen-key',
      avatarId: 'avatar-7',
    });

    expect(sub.jobId).toBe('vid-123');
    const r = recs[0];
    expect(r.url).toBe('https://api.heygen.com/v2/video/generate');
    expect(r.method).toBe('POST');
    expect(r.headers['x-api-key']).toBe('heygen-key');
    const body = JSON.parse(r.body);
    expect(body.video_inputs).toEqual([
      {
        character: { type: 'avatar', avatar_id: 'avatar-7' },
        voice: { type: 'text', input_text: 'hello there' },
      },
    ]);
  });

  it('pollJob (bare id = avatar video) hits v1/video_status.get and parses completed → video_url', async () => {
    const { recs, ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ data: { status: 'processing' } })
        : res({ data: { status: 'completed', video_url: 'https://cdn.heygen/out.mp4' } }),
    );
    const adapter: any = heygenMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('vid-123', { apiKey: 'heygen-key' });
    expect(pending.status).toBe('pending');
    expect(recs[0].url).toBe('https://api.heygen.com/v1/video_status.get?video_id=vid-123');

    const done = await adapter.pollJob('vid-123', { apiKey: 'heygen-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.heygen/out.mp4');
  });

  it('pollJob with a `translate:` namespace routes to the v2/video_translate endpoint (success → url)', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ data: { status: 'success', url: 'https://cdn.heygen/translated.mp4' } }),
    );
    const adapter: any = heygenMediaModule.create(ctx as any);

    const done = await adapter.pollJob('translate:tr-9', { apiKey: 'heygen-key' });
    expect(recs[0].url).toBe('https://api.heygen.com/v2/video_translate/tr-9');
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.heygen/translated.mp4');
  });

  it('2.1: a 503 on poll THROWS (transient) so the render is not permanently failed', async () => {
    const { ctx } = makeCtx(() => res('temporarily unavailable', false, 503));
    const adapter: any = heygenMediaModule.create(ctx as any);
    await expect(adapter.pollJob('vid-123', { apiKey: 'k' })).rejects.toThrow(/transient/i);
  });

  it('2.1: a provider status:failed → returned { status: failed } (permanent)', async () => {
    const { ctx } = makeCtx(() => res({ data: { status: 'failed', error: { message: 'render error' } } }));
    const adapter: any = heygenMediaModule.create(ctx as any);
    const r = await adapter.pollJob('vid-123', { apiKey: 'k' });
    expect(r.status).toBe('failed');
    expect(r.error).toBe('render error');
  });

  it('2.1: a 4xx on poll → returned { status: failed } (permanent, not thrown)', async () => {
    const { ctx } = makeCtx(() => res('bad request', false, 400));
    const adapter: any = heygenMediaModule.create(ctx as any);
    const r = await adapter.pollJob('vid-123', { apiKey: 'k' });
    expect(r.status).toBe('failed');
  });

  it('2.1: a missing key on poll → terminal failed (not thrown)', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = heygenMediaModule.create(ctx as any);
    const r = await adapter.pollJob('vid-123', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/key is required/);
  });

  it('5.11: an unknown `<op>:` prefix is treated as a BARE avatar-video id (full id sent, not stripped)', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: { status: 'completed', video_url: 'https://cdn/x.mp4' } }));
    const adapter: any = heygenMediaModule.create(ctx as any);
    const done = await adapter.pollJob('weird:abc', { apiKey: 'k' });
    expect(done.status).toBe('completed');
    // full string used as the video id, routed to the avatar-video endpoint
    expect(recs[0].url).toBe('https://api.heygen.com/v1/video_status.get?video_id=weird%3Aabc');
  });

  it('rejects a missing key and unsupported image/audio operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = heygenMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('HeyGen API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
