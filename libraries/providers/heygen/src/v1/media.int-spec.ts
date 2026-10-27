import { describe, it, expect, vi } from 'vitest';
import { ProviderUpstreamError } from '@postmill-ai/provider-kernel';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { heygenMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. A stub ctx.fetch records the
// request the adapter builds and returns canned responses matching HeyGen's documented shape.
// HeyGen is async submit-and-poll; pollJob is operation-namespaced (`<op>:<id>`), a bare id
// being an avatar-video job.

describe('heygen media adapter (async avatar-video submit-and-poll)', () => {
  it('POSTs avatar video to /v2/video/generate with the x-api-key header and the video_inputs body', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: { video_id: 'vid-123' } }));
    const adapter: any = heygenMediaModule.create(ctx as any);

    const sub = await adapter.generateAvatar('hello there', {
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

  it('declares avatar video and TTS without enabling ordinary video or music generation', () => {
    expect(heygenMediaModule.metadata?.mediaCategories).toEqual(['text-to-speech', 'video-avatar']);
    expect(heygenMediaModule.manifest.capabilities).toMatchObject({ video: false, audio: false, avatar: true, tts: true });
  });

  it('rejects ordinary video before credential resolution or network I/O', async () => {
    const { recs, ctx } = makeCtx(() => res({}));
    const adapter: any = heygenMediaModule.create(ctx as any);

    await expect(adapter.generateVideo('x', {})).rejects.toThrow('does not support video generation');
    expect(recs).toHaveLength(0);
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
    // provider-reported failures are attributed to the provider
    expect(r.error).toBe('HeyGen returned an error: render error');
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
    await expect(adapter.generateAvatar('x', {})).rejects.toThrow('HeyGen API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
  });

  it('listModels(video) maps the account avatar catalog to {id: avatar_id, label: avatar_name}', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({
        data: {
          avatars: [
            { avatar_id: 'av-1', avatar_name: 'Ann' },
            { avatar_id: 'av-2', avatar_name: 'Bob' },
            { avatar_id: '' },
          ],
        },
      }),
    );
    const adapter: any = heygenMediaModule.create(ctx as any);

    const models = await adapter.listModels('video', { apiKey: 'heygen-key' });

    expect(models).toEqual([
      { id: 'av-1', label: 'Ann' },
      { id: 'av-2', label: 'Bob' },
    ]);
    expect(recs[0].url).toBe('https://api.heygen.com/v2/avatars');
    expect(recs[0].headers['x-api-key']).toBe('heygen-key');
  });

  it('testConnection validates the key against the cheap /v2/voices endpoint', async () => {
    // /v2/avatars is a multi-MB, 45s+ catalog on real accounts — using it as
    // the "Test connection" probe blew the 30s outbound budget and falsely
    // failed valid keys (prod, 2026-10-22).
    const { recs, ctx } = makeCtx(() => res({ data: { voices: [] } }));
    const adapter: any = heygenMediaModule.create(ctx as any);

    const result = await adapter.testConnection({ apiKey: 'heygen-key' });

    expect(result).toEqual({ ok: true, message: 'Connection successful' });
    expect(recs[0].url).toBe('https://api.heygen.com/v2/voices');
    expect(recs[0].headers['x-api-key']).toBe('heygen-key');
  });

  it('listModels extends the outbound timeout for the huge avatar catalog', async () => {
    let seenTimeout: number | undefined;
    const { ctx } = makeCtx((_url, init) => {
      seenTimeout = init?.timeoutMs;
      return res({ data: { avatars: [] } });
    });
    const adapter: any = heygenMediaModule.create(ctx as any);

    await adapter.listModels('video', { apiKey: 'k' });

    expect(seenTimeout).toBe(120_000);
  });

  it('listModels returns [] for non-video operations and on API failure (never throws)', async () => {
    const { ctx } = makeCtx(() => res('nope', false, 500));
    const adapter: any = heygenMediaModule.create(ctx as any);

    expect(await adapter.listModels('image', { apiKey: 'k' })).toEqual([]);
    expect(await adapter.listModels('video', { apiKey: 'k' })).toEqual([]);
  });

  it('generateAvatar falls back to options.model as the avatar id (media-defaults resolution)', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: { video_id: 'vid-9' } }));
    const adapter: any = heygenMediaModule.create(ctx as any);

    await adapter.generateAvatar('hi', { apiKey: 'heygen-key', model: 'av-1' });

    const body = JSON.parse(recs[0].body);
    expect(body.video_inputs[0].character).toEqual({ type: 'avatar', avatar_id: 'av-1' });
  });

  it('lists HeyGen voices for the shared Designer voice picker', async () => {
    const { recs, ctx } = makeCtx(() => res({
      data: { voices: [{ voice_id: 'voice-1', name: 'Ava', preview_audio: 'https://cdn.heygen/ava.mp3' }] },
    }));
    const adapter: any = heygenMediaModule.create(ctx as any);

    await expect(adapter.listVoices({ apiKey: 'heygen-key' })).resolves.toEqual([
      { id: 'voice-1', label: 'Ava', previewUrl: 'https://cdn.heygen/ava.mp3' },
    ]);
    expect(recs[0].url).toBe('https://api.heygen.com/v2/voices');
  });

  it('submits documented v3 speech and downloads the returned audio without forwarding the API key', async () => {
    const { recs, ctx } = makeCtx((url) => {
      if (url.includes('/v3/voices/speech')) {
        return res({ data: { audio_url: 'https://cdn.heygen/voice.mp3', duration: 2.5 } });
      }
      return res('mp3-audio');
    });
    const adapter: any = heygenMediaModule.create(ctx as any);

    const audio = await adapter.textToSpeech('A faceless product ad', { apiKey: 'heygen-key', voice: 'voice-1' });

    expect(audio.toString()).toBe('mp3-audio');
    expect(recs).toHaveLength(2);
    expect(recs[0].url).toBe('https://api.heygen.com/v3/voices/speech');
    expect(recs[0].method).toBe('POST');
    expect(recs[0].headers['x-api-key']).toBe('heygen-key');
    expect(JSON.parse(recs[0].body)).toEqual({ voice_id: 'voice-1', text: 'A faceless product ad' });
    expect(recs[1].url).toBe('https://cdn.heygen/voice.mp3');
    expect(recs[1].headers['x-api-key']).toBeUndefined();
  });

  it('retries a transient speech submission failure instead of aborting the request', async () => {
    let submitCalls = 0;
    const { recs, ctx } = makeCtx((url) => {
      if (url.includes('/v3/voices/speech')) {
        submitCalls++;
        return submitCalls === 1
          ? res('temporary', false, 503)
          : res({ data: { audio_url: 'https://cdn.heygen/voice.mp3' } });
      }
      return res('mp3-audio');
    });
    const adapter: any = heygenMediaModule.create(ctx as any);

    const audio = await adapter.textToSpeech('hello', { apiKey: 'heygen-key', voice: 'voice-1' });

    expect(audio.toString()).toBe('mp3-audio');
    expect(submitCalls).toBe(2);
    expect(recs).toHaveLength(3);
  }, 10_000);

  it('classifies a transient failure on the final speech submission attempt as a provider outage', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = makeCtx(() => res('unavailable', false, 503));
      const adapter: any = heygenMediaModule.create(ctx as any);
      const pending = adapter.textToSpeech('hello', { apiKey: 'heygen-key', voice: 'voice-1' });
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'unavailable' });
      await vi.advanceTimersByTimeAsync(3_000);

      await assertion;
      expect(await pending.catch((err) => err)).toBeInstanceOf(ProviderUpstreamError);
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  it('keeps legacy TTS job polling transient and terminal status semantics', async () => {
    const { recs, ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res('temporary', false, 503)
        : res({ data: { status: 'completed', audio_url: 'https://cdn.heygen/legacy.mp3' } }),
    );
    const adapter: any = heygenMediaModule.create(ctx as any);

    await expect(adapter.pollJob('tts:audio-1', { apiKey: 'heygen-key' })).rejects.toThrow(/transient/i);
    await expect(adapter.pollJob('tts:audio-1', { apiKey: 'heygen-key' })).resolves.toMatchObject({
      status: 'completed',
      artifactUrl: 'https://cdn.heygen/legacy.mp3',
    });
    expect(recs[0].url).toBe('https://api.heygen.com/v1/audio_status.get?audio_id=audio-1');
  });

  it('requires an explicit voice and preserves TTS upstream errors', async () => {
    const { ctx } = makeCtx(() => res({ detail: 'invalid voice' }, false, 400));
    const adapter: any = heygenMediaModule.create(ctx as any);

    await expect(adapter.textToSpeech('hello', { apiKey: 'heygen-key' })).rejects.toThrow('voice is required');
    await expect(adapter.textToSpeech('hello', { apiKey: 'heygen-key', voice: 'bad' })).rejects.toThrow('HeyGen rejected');
  });
});
