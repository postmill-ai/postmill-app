import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { gatewayMediaModule } from './media.adapter';

// 5.7 — the gateway video path calls AI SDK's experimental_generateVideo directly (not ctx.fetch),
// so a size-guard test must mock that SDK. We use a per-test scoped vi.doMock + resetModules so the
// mock never leaks to the co-running gateway AI-adapter spec (a top-level vi.mock('ai') does).
async function loadWithVideoResult(videoResult: unknown) {
  vi.resetModules();
  vi.doMock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
      ...actual,
      createGateway: () => ({ video: (m: string) => m }),
      experimental_generateVideo: vi.fn().mockResolvedValue(videoResult),
    };
  });
  const mod = await import('./media.adapter');
  return mod.gatewayMediaModule;
}

afterEach(() => {
  vi.doUnmock('ai');
  vi.resetModules();
});

// Recorded-fixture integration test (plan B4) — no network.
//
// REDUCED COVERAGE (by design): the Gateway adapter's two generation paths do NOT go through
// ctx.fetch, so they can't be recorded here:
//   * generateImage delegates to the AI SDK gateway provider via the AiSdkMediaAdapter base
//     (statically-injected AI registry), and
//   * generateVideo calls AI SDK v6's experimental `generateVideo` directly with its own
//     long-timeout Undici dispatcher (synchronous, no poll/webhook).
// So for those paths we assert only the capability/manifest surface and the pre-flight
// missing-model / missing-credential / unsupported-operation rejections (all of which run
// before any AI-SDK call). `listModels` IS a plain ctx.fetch call, so it gets a recorded test.

describe('gateway media adapter (AI-SDK delegation)', () => {
  it('exposes an image+video capability manifest', () => {
    expect(gatewayMediaModule.manifest.providerId).toBe('gateway');
    const caps = gatewayMediaModule.manifest.capabilities;
    expect(caps.image).toBe(true);
    expect(caps.video).toBe(true);
    expect(caps.audio).toBe(false);
    expect(caps.avatar).toBe(false);
  });

  it('listModels hits /v1/models with Bearer auth and filters by modality', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({
        data: [
          { id: 'img-1', name: 'Image One', type: 'image' },
          { id: 'vid-1', name: 'Video One', type: 'video' },
          { id: 'txt-1', name: 'Text One', type: 'language' },
        ],
      }),
    );
    const adapter: any = gatewayMediaModule.create(ctx as any);

    const imageModels = await adapter.listModels('image', { apiKey: 'vck_test' });
    expect(recs[0].url).toBe('https://ai-gateway.vercel.sh/v1/models');
    expect(recs[0].headers.Authorization).toBe('Bearer vck_test');
    expect(imageModels).toEqual([{ id: 'img-1', label: 'Image One' }]);

    const videoModels = await adapter.listModels('video', { apiKey: 'vck_test' });
    expect(videoModels).toEqual([{ id: 'vid-1', label: 'Video One' }]);
  });

  it('listModels returns empty (no fetch) when no key is supplied', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = gatewayMediaModule.create(ctx as any);
    expect(await adapter.listModels('image', {})).toEqual([]);
    expect(recs).toHaveLength(0);
  });

  it('generateVideo rejects a missing model and a missing key before any AI-SDK call', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = gatewayMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('requires a model');
    await expect(adapter.generateVideo('x', { model: 'm' })).rejects.toThrow(
      'Vercel AI API key is required',
    );
  });

  it('5.7: an oversize video is rejected before base64-inflating (no huge allocation)', async () => {
    // uint8Array with a huge .length but no backing buffer — the guard reads .length and throws
    // BEFORE Buffer.from() would allocate/copy it.
    const mod = await loadWithVideoResult({
      videos: [{ uint8Array: { length: 600 * 1024 * 1024 } as unknown as Uint8Array }],
    });
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = mod.create(ctx as any);
    await expect(adapter.generateVideo('a long clip', { model: 'video-1', apiKey: 'vck_test' })).rejects.toThrow(
      /exceeds the size limit/,
    );
  });

  it('5.7: an under-cap video passes and is inlined as a data URL', async () => {
    const mod = await loadWithVideoResult({
      videos: [{ base64: Buffer.from('SMALLVIDEO').toString('base64'), mediaType: 'video/mp4' }],
    });
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = mod.create(ctx as any);
    const sub = await adapter.generateVideo('a short clip', { model: 'video-1', apiKey: 'vck_test' });
    expect(sub.artifactUrl).toBe(`data:video/mp4;base64,${Buffer.from('SMALLVIDEO').toString('base64')}`);
  });

  it('generateImage rejects a missing model; audio/avatar are unsupported', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = gatewayMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('requires a model');
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support audio',
    );
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support avatar',
    );
  });
});
