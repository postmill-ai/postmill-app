import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { elevenlabsMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. ElevenLabs TTS is synchronous: a
// single POST to /v1/text-to-speech/{voiceId} returns audio bytes (read via arrayBuffer), which
// the adapter returns inline as a data:audio/mpeg;base64 URL. No pollJob.

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

  it('falls back to the default voice id and model when no input is given', async () => {
    const { recs, ctx } = makeCtx(() => res('AUDIO'));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);

    await adapter.generateAudio('hi', { apiKey: 'eleven-key' });

    const r = recs[0];
    expect(r.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');
    const body = JSON.parse(r.body);
    expect(body.model_id).toBe('eleven_monolingual_v1');
    expect(body.voice_settings).toEqual({ stability: 0.5, similarity_boost: 0.75 });
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res('x'));
    const adapter: any = elevenlabsMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', {})).rejects.toThrow('API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
