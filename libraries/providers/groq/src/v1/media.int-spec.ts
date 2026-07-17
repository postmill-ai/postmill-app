import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { groqMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Groq's only media surface is TTS
// over the OpenAI-compatible base (POST /openai/v1/audio/speech). Synchronous: the clip is read
// via arrayBuffer and returned inline as a data: URL. No image/video, no model catalog.

describe('groq media adapter (OpenAI-compatible TTS)', () => {
  it('POSTs to /openai/v1/audio/speech with Bearer auth, OpenAI-compatible body, and returns the clip inline as a data: URL', async () => {
    const { recs, ctx } = makeCtx(() => res('GROQAUDIO'));
    const adapter: any = groqMediaModule.create(ctx as any);

    const out = await adapter.generateAudio('say something', {
      apiKey: 'groq-key',
      input: { voice: 'Aaliyah-PlayAI', response_format: 'mp3' },
    });

    const r = recs[0];
    expect(r.url).toBe('https://api.groq.com/openai/v1/audio/speech');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer groq-key');
    expect(r.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('playai-tts');
    expect(body.input).toBe('say something');
    expect(body.voice).toBe('Aaliyah-PlayAI');
    expect(body.response_format).toBe('mp3');

    const expectedB64 = Buffer.from('GROQAUDIO').toString('base64');
    expect(out.artifactUrl).toBe(`data:audio/mpeg;base64,${expectedB64}`);
    expect(out.jobId).toBe(`groq-audio-${Buffer.from('GROQAUDIO').length}`);
    expect(out.metadata).toMatchObject({ provider: 'groq', model: 'playai-tts' });
  });

  it('falls back to the default voice when none is supplied', async () => {
    const { recs, ctx } = makeCtx(() => res('A'));
    const adapter: any = groqMediaModule.create(ctx as any);
    await adapter.generateAudio('hi', { apiKey: 'groq-key' });
    const body = JSON.parse(recs[0].body);
    expect(body.voice).toBe('Fritz-PlayAI');
    expect(body.response_format).toBe('mp3');
  });

  it('listModels returns an empty list (no TTS-tagged catalog)', async () => {
    const { ctx } = makeCtx(() => res({ data: [] }));
    const adapter: any = groqMediaModule.create(ctx as any);
    expect(await adapter.listModels('audio', { apiKey: 'groq-key' })).toEqual([]);
  });

  it('rejects a missing key and unsupported operations', async () => {
    const { ctx } = makeCtx(() => res('x'));
    const adapter: any = groqMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('x', {})).rejects.toThrow('Groq API key is required');
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
  });
});
