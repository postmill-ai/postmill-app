import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { hedraMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. A stub ctx.fetch records the
// request the adapter builds and returns canned responses matching Hedra's documented shape.
// Hedra is an async submit-and-poll character-video provider.

describe('hedra media adapter (async character-video submit-and-poll)', () => {
  it('POSTs to /generations with the X-API-Key header and routes prompt/model/keyframe into the body', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'gen-123' }));
    const adapter: any = hedraMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a person talking', {
      apiKey: 'hedra-key',
      model: 'hedra-character-2',
      input: { start_keyframe: 'https://cdn.example/key.png', aspect_ratio: '16:9' },
    });

    expect(sub.jobId).toBe('gen-123');
    const r = recs[0];
    expect(r.url).toBe('https://api.hedra.com/web-app/public/generations');
    expect(r.method).toBe('POST');
    expect(r.headers['X-API-Key']).toBe('hedra-key');
    const body = JSON.parse(r.body);
    expect(body.type).toBe('video');
    expect(body.text_prompt).toBe('a person talking');
    expect(body.ai_model_id).toBe('hedra-character-2');
    expect(body.start_keyframe_url).toBe('https://cdn.example/key.png');
    expect(body.aspect_ratio).toBe('16:9');
  });

  it('pollJob parses an in-progress status → pending and complete → completed with the asset URL', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ status: 'processing' })
        : res({ status: 'complete', url: 'https://cdn.hedra/out.mp4' }),
    );
    const adapter: any = hedraMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('gen-123', { apiKey: 'hedra-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('gen-123', { apiKey: 'hedra-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.hedra/out.mp4');
  });

  it('rejects a missing key and unsupported image/audio operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = hedraMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('Hedra API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
