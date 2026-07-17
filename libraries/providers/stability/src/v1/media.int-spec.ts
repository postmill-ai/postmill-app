import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { stabilityMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Stability has a synchronous image
// path (multipart `POST /v2beta/stable-image/generate/<model>`, inline base64 image) and an
// async image-to-video path (`POST /v2beta/image-to-video` → poll
// `/v2beta/image-to-video/result/<id>`, 202 = pending).

describe('stability media adapter (sync image + async image-to-video)', () => {
  it('generateImage POSTs multipart to the selected endpoint and returns an inline data URL', async () => {
    const { recs, ctx } = makeCtx(() => res({ image: 'QkFTRTY0', seed: 42 }));
    const adapter: any = stabilityMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a red fox', {
      apiKey: 'stab-key',
      model: 'ultra',
      input: { style_preset: 'photographic', aspect_ratio: '1:1' },
    });

    const r = recs[0];
    expect(r.url).toBe('https://api.stability.ai/v2beta/stable-image/generate/ultra');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer stab-key');
    expect(r.headers.Accept).toBe('application/json');
    const form = r.body as FormData;
    expect(form.get('prompt')).toBe('a red fox');
    expect(form.get('style_preset')).toBe('photographic');
    expect(form.get('aspect_ratio')).toBe('1:1');
    expect(form.get('output_format')).toBe('png');
    expect(out.image).toBe('data:image/png;base64,QkFTRTY0');
  });

  it('generateVideo fetches the source frame then submits image-to-video, and pollJob resolves 202 → pending, completed → video', async () => {
    const { recs, ctx } = makeCtx((url) =>
      url === 'https://src.example/frame.png' ? res('rawbytes') : res({ id: 'vid-job-1' }),
    );
    const adapter: any = stabilityMediaModule.create(ctx as any);
    const sub = await adapter.generateVideo('animate', {
      apiKey: 'stab-key',
      sourceUrl: 'https://src.example/frame.png',
    });
    expect(sub.jobId).toBe('vid-job-1');
    expect(recs[0].url).toBe('https://src.example/frame.png');
    expect(recs[1].url).toBe('https://api.stability.ai/v2beta/image-to-video');
    expect(recs[1].method).toBe('POST');
    expect(recs[1].headers.Authorization).toBe('Bearer stab-key');

    const pendingCtx = makeCtx(() => res({}, true, 202));
    const pendingAdapter: any = stabilityMediaModule.create(pendingCtx.ctx as any);
    const pending = await pendingAdapter.pollJob('vid-job-1', { apiKey: 'stab-key' });
    expect(pending.status).toBe('pending');
    expect(pendingCtx.recs[0].url).toBe(
      'https://api.stability.ai/v2beta/image-to-video/result/vid-job-1',
    );

    const doneCtx = makeCtx(() => res({ video: 'VklERU8=' }));
    const doneAdapter: any = stabilityMediaModule.create(doneCtx.ctx as any);
    const done = await doneAdapter.pollJob('vid-job-1', { apiKey: 'stab-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('data:video/mp4;base64,VklERU8=');
  });

  it('rejects a missing key, a video without a source image, and unsupported avatar generation', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = stabilityMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('Stability AI API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow(
      'requires a source image',
    );
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
