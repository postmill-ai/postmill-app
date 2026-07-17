import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { didMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. A stub ctx.fetch records the
// request the adapter builds and returns canned responses matching D-ID's documented shape.
// D-ID is an async submit-and-poll talking-avatar provider.

describe('did media adapter (async talking-avatar submit-and-poll)', () => {
  it('POSTs to /talks with Basic auth and routes the prompt into script.input + the source image into source_url', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'talk-123' }));
    const adapter: any = didMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('hello world', {
      apiKey: 'did-key',
      input: { source_image: 'https://cdn.example/face.png' },
    });

    expect(sub.jobId).toBe('talk-123');
    const r = recs[0];
    expect(r.url).toBe('https://api.d-id.com/talks');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Basic did-key');
    const body = JSON.parse(r.body);
    expect(body.script).toEqual({ type: 'text', input: 'hello world' });
    expect(body.source_url).toBe('https://cdn.example/face.png');
  });

  it('pollJob parses an in-progress status → pending and done → completed with the result_url artifact', async () => {
    const { ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ status: 'started' })
        : res({ status: 'done', result_url: 'https://cdn.d-id/out.mp4' }),
    );
    const adapter: any = didMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('talk-123', { apiKey: 'did-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('talk-123', { apiKey: 'did-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.d-id/out.mp4');
  });

  it('rejects a missing key and unsupported image/audio operations', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = didMediaModule.create(ctx as any);
    await expect(
      adapter.generateVideo('x', { input: { source_image: 'https://cdn.example/face.png' } }),
    ).rejects.toThrow('D-ID API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
