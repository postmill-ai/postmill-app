import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { elevenlabsMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. ElevenLabs TTS is synchronous: a
// single POST to /v1/text-to-speech/{voiceId} returns audio bytes (read via arrayBuffer), which
// the adapter returns inline as a data:audio/mpeg;base64 URL.
//
// UNVERIFIED vs live key: the Image & Video (Flows API) request/response shapes below are taken
// from the ElevenLabs docs (https://elevenlabs.io/docs/api-reference/flows/image/create et al.),
// not from a recorded live session: POST /v1/flows/{image,video} → {id, status:'pending'};
// GET /v1/flows/{image,video}/{id} → {status, content_url?, content_mime_type?, failure_reason?,
// error_message?}.

describe('elevenlabs media adapter (synchronous TTS)', () => {
  it('POSTs to /v1/text-to-speech/{voiceId} with xi-api-key auth, routes input params into the body, and returns the clip inline as a data: URL', async () => {
    const { recs, ctx } = makeCtx(() => res('FAKEAUDIO'));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    const out = await adapter.generateAudio('hello world', {
      apiKey: 'eleven-key',
      input: {
        voice_id: 'voiceXYZ',
        model_id: 'eleven_turbo_v2',
        stability: 0.3,
        similarity_boost: 0.9,
        style: 0.2,
        use_speaker_boost: true,
      },
    });

    const r = recs[0];
    expect(r.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voiceXYZ');
    expect(r.method).toBe('POST');
    expect(r.headers['xi-api-key']).toBe('eleven-key');
    expect(r.headers.Accept).toBe('audio/mpeg');
    expect(r.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(r.body);
    expect(body.text).toBe('hello world');
    expect(body.model_id).toBe('eleven_turbo_v2');
    expect(body.voice_settings).toEqual({
      stability: 0.3,
      similarity_boost: 0.9,
      style: 0.2,
      use_speaker_boost: true,
    });

    const expectedB64 = Buffer.from('FAKEAUDIO').toString('base64');
    expect(out.artifactUrl).toBe(`data:audio/mpeg;base64,${expectedB64}`);
    expect(out.metadata).toMatchObject({ provider: 'elevenlabs', mime: 'audio/mpeg' });
  });

  it('falls back to the default voice id and the current default model (eleven_multilingual_v2 — the v1 models were retired upstream)', async () => {
    const { recs, ctx } = makeCtx(() => res('AUDIO'));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    await adapter.generateAudio('hi', { apiKey: 'eleven-key' });

    const r = recs[0];
    expect(r.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');
    const body = JSON.parse(r.body);
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.voice_settings).toEqual({ stability: 0.5, similarity_boost: 0.75 });
  });

  it('rejects a missing key and the unsupported avatar operation', async () => {
    const { ctx } = makeCtx(() => res('x'));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });
});

describe('elevenlabs flows image (submit + bounded inline poll)', () => {
  it('submits to /v1/flows/image with model_id in the body, whitelists per-model fields, and inline-polls to the completed content_url', async () => {
    const { recs, ctx } = makeCtx((url) => {
      if (url.endsWith('/flows/image')) return res({ id: 'gen-1', status: 'pending' });
      return res({
        id: 'gen-1',
        status: 'completed',
        content_url: 'https://storage.googleapis.com/generations/gen-1',
        content_mime_type: 'image/png',
      });
    });
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a corgi lifeguard', {
      apiKey: 'eleven-key',
      model: 'gemini-3.1-flash-image',
      input: {
        aspect_ratio: '16:9',
        resolution: '2K',
        // Not accepted by this model (or by the API at all) — must NOT be forwarded:
        quality: 'high',
        seed: 42,
        negative_prompt: 'blurry',
      },
    });

    const submit = recs[0];
    expect(submit.url).toBe('https://api.elevenlabs.io/v1/flows/image');
    expect(submit.method).toBe('POST');
    expect(submit.headers['xi-api-key']).toBe('eleven-key');
    const body = JSON.parse(submit.body);
    expect(body).toEqual({
      model_id: 'gemini-3.1-flash-image',
      prompt: 'a corgi lifeguard',
      aspect_ratio: '16:9',
      resolution: '2K',
    });

    const poll = recs[1];
    expect(poll.url).toBe('https://api.elevenlabs.io/v1/flows/image/gen-1');
    expect(poll.method).toBe('GET');
    expect(poll.headers['xi-api-key']).toBe('eleven-key');

    expect(out.image).toBe('https://storage.googleapis.com/generations/gen-1');
    expect(out.images).toEqual(['https://storage.googleapis.com/generations/gen-1']);
    expect(out.metadata).toMatchObject({ provider: 'elevenlabs', model: 'gemini-3.1-flash-image', mime: 'image/png' });
  }, 15000);

  it('forwards the gpt-image-1 field set (aspect_ratio/quality/background) and drops resolution', async () => {
    const { recs, ctx } = makeCtx((url) => {
      if (url.endsWith('/flows/image')) return res({ id: 'gen-2', status: 'pending' });
      return res({ id: 'gen-2', status: 'completed', content_url: 'https://cdn.el/img.png', content_mime_type: 'image/png' });
    });
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    await adapter.generateImage('logo', {
      apiKey: 'eleven-key',
      model: 'gpt-image-1',
      input: { aspect_ratio: '3:2', quality: 'high', background: 'transparent', resolution: '4K', duration_secs: 8 },
    });

    const body = JSON.parse(recs[0].body);
    expect(body).toEqual({
      model_id: 'gpt-image-1',
      prompt: 'logo',
      aspect_ratio: '3:2',
      quality: 'high',
      background: 'transparent',
    });
  }, 15000);

  it('a generation that completes with failure_reason throws an attributed upstream error', async () => {
    const { ctx } = makeCtx((url) => {
      if (url.endsWith('/flows/image')) return res({ id: 'gen-3', status: 'pending' });
      return res({
        id: 'gen-3',
        status: 'failed',
        failure_reason: 'moderated',
        error_message: 'The prompt was rejected by content moderation.',
      });
    });
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    await expect(adapter.generateImage('bad prompt', { apiKey: 'eleven-key' })).rejects.toThrow(/moderated/);
  }, 15000);

  it('a 402 paid_plan_required on submit surfaces as an upstream quota error', async () => {
    const { ctx } = makeCtx(() =>
      res({ message: 'paid_plan_required: the Image & Video API requires a Pro plan' }, false, 402),
    );
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    await expect(adapter.generateImage('x', { apiKey: 'eleven-key' })).rejects.toThrow(/Pro plan/);
    await expect(adapter.generateImage('x', { apiKey: 'eleven-key' })).rejects.toThrow(/quota|billing/i);
  });

  it('rejects a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', {})).rejects.toThrow('API key is required');
  });
});

describe('elevenlabs flows video (submit + lifecycle poll)', () => {
  it('submits to /v1/flows/video and returns a modality-prefixed job id, forwarding only veo fields', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'vid-1', status: 'pending' }));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a corgi surfing', {
      apiKey: 'eleven-key',
      model: 'veo-3.1-fast-generate-001',
      input: {
        duration_secs: 8,
        aspect_ratio: '16:9',
        resolution: '1080p',
        generate_audio: true,
        // Not veo params — must NOT be forwarded:
        seed: 7,
        quality: 'high',
      },
    });

    expect(sub.jobId).toBe('video::vid-1');
    const r = recs[0];
    expect(r.url).toBe('https://api.elevenlabs.io/v1/flows/video');
    expect(r.method).toBe('POST');
    expect(JSON.parse(r.body)).toEqual({
      model_id: 'veo-3.1-fast-generate-001',
      prompt: 'a corgi surfing',
      duration_secs: 8,
      aspect_ratio: '16:9',
      resolution: '1080p',
      generate_audio: true,
    });
  });

  it('pollJob routes on the job-id modality prefix: pending/generating → pending, completed → artifactUrl, failed → failure_reason mapped', async () => {
    const { recs, ctx } = makeCtx((_url, _init, n) => {
      if (n === 1) return res({ id: 'vid-1', status: 'generating' });
      if (n === 2) {
        return res({
          id: 'vid-1',
          status: 'completed',
          content_url: 'https://storage.googleapis.com/generations/vid-1',
          content_mime_type: 'video/mp4',
        });
      }
      return res({ id: 'vid-2', status: 'failed', failure_reason: 'model_error', error_message: 'The model produced no output.' });
    });
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('video::vid-1', { apiKey: 'k' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('video::vid-1', { apiKey: 'k' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://storage.googleapis.com/generations/vid-1');
    expect(done.metadata).toMatchObject({ provider: 'elevenlabs', mime: 'video/mp4' });

    const failed = await adapter.pollJob('video::vid-2', { apiKey: 'k' });
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/model_error/);
    expect(failed.error).toMatch(/produced no output/);

    expect(recs[0].url).toBe('https://api.elevenlabs.io/v1/flows/video/vid-1');
    expect(recs[2].url).toBe('https://api.elevenlabs.io/v1/flows/video/vid-2');
  });

  it('pollJob on the image modality hits /v1/flows/image/{id}', async () => {
    const { recs, ctx } = makeCtx(() => res({ id: 'gen-9', status: 'pending' }));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    const out = await adapter.pollJob('image::gen-9', { apiKey: 'k' });
    expect(out.status).toBe('pending');
    expect(recs[0].url).toBe('https://api.elevenlabs.io/v1/flows/image/gen-9');
  });

  it('2.1: a 503 on poll THROWS (transient); a 4xx on poll → returned failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = elevenlabsMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('video::vid-1', { apiKey: 'k' })).rejects.toThrow(/transient/i);

    const four = makeCtx(() => res('gone', false, 404));
    const a2: any = elevenlabsMediaModule.create(four.ctx as any);
    expect((await a2.pollJob('video::vid-1', { apiKey: 'k' })).status).toBe('failed');
  });

  it('missing key on poll → terminal failed; malformed job id → terminal failed', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    const noKey = await adapter.pollJob('video::vid-1', {});
    expect(noKey.status).toBe('failed');
    expect(noKey.error).toMatch(/key is required/);

    for (const bad of ['vid-1', 'audio::vid-1', 'video::', 'video::../admin']) {
      const out = await adapter.pollJob(bad, { apiKey: 'k' });
      expect(out.status).toBe('failed');
      expect(out.error).toMatch(/malformed/);
    }
  });

  it('rejects a missing key on submit', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
  });
});
