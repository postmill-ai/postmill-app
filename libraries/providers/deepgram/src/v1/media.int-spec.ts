import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { deepgramMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Deepgram is STT: it POSTs the audio
// bytes to /v1/listen and parses TEXT (transcript + word timings) from the canned response — it
// produces no media artifact, so there is no job/pollJob. We assert the request (URL/auth/
// content-type) and the parsed words/text.

const LISTEN_RESPONSE = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'hello world',
            words: [
              { word: 'hello', start: 0, end: 0.5 },
              { word: 'world', start: 0.5, end: 1 },
            ],
          },
        ],
      },
    ],
  },
};

describe('deepgram media adapter (speech-to-text)', () => {
  it('speechToTextWords POSTs audio to /v1/listen with Token auth and parses transcript + words', async () => {
    const { recs, ctx } = makeCtx(() => res(LISTEN_RESPONSE));
    const adapter: any = deepgramMediaModule.create(ctx as any);

    const out = await adapter.speechToTextWords(Buffer.from('AUDIOBYTES'), { apiKey: 'dg-key' });

    const r = recs[0];
    expect(r.url).toBe('https://api.deepgram.com/v1/listen?model=whisper');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Token dg-key');
    expect(r.headers['Content-Type']).toBe('audio/wav');
    expect(out.text).toBe('hello world');
    expect(out.words).toEqual([
      { word: 'hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.5, end: 1 },
    ]);
  });

  it('speechToTextWords adds smart_format/punctuate and language when passed via input', async () => {
    const { recs, ctx } = makeCtx(() => res(LISTEN_RESPONSE));
    const adapter: any = deepgramMediaModule.create(ctx as any);

    await adapter.speechToTextWords(Buffer.from('AUDIO'), {
      apiKey: 'dg-key',
      model: 'nova-2',
      mimeType: 'audio/mp3',
      input: { smartFormat: true, language: 'en' },
    });

    const r = recs[0];
    expect(r.url).toBe(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&language=en',
    );
    expect(r.headers['Content-Type']).toBe('audio/mp3');
  });

  it('speechToText returns just the transcript string', async () => {
    const { recs, ctx } = makeCtx(() => res(LISTEN_RESPONSE));
    const adapter: any = deepgramMediaModule.create(ctx as any);
    const text = await adapter.speechToText(Buffer.from('AUDIO'), { apiKey: 'dg-key' });
    expect(text).toBe('hello world');
    expect(recs[0].url).toBe('https://api.deepgram.com/v1/listen?model=whisper');
  });

  it('rejects a missing key and unsupported generative operations', async () => {
    const { ctx } = makeCtx(() => res(LISTEN_RESPONSE));
    const adapter: any = deepgramMediaModule.create(ctx as any);
    await expect(adapter.speechToTextWords(Buffer.from('x'), {})).rejects.toThrow('API key is required');
    await expect(adapter.speechToText(Buffer.from('x'), {})).rejects.toThrow('API key is required');
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow();
  });

  // 6.1c — a model value with an injected param is URL-encoded (no extra Deepgram params).
  it('speechToText encodes a model containing &callback= (no param injection)', async () => {
    const { recs, ctx } = makeCtx(() => res(LISTEN_RESPONSE));
    const adapter: any = deepgramMediaModule.create(ctx as any);
    await adapter.speechToText(Buffer.from('AUDIO'), { apiKey: 'dg-key', model: 'nova&callback=https://evil' });
    // The whole value rides as a single encoded `model` param; `&callback=` is escaped.
    expect(recs[0].url).toBe(
      'https://api.deepgram.com/v1/listen?model=nova%26callback%3Dhttps%3A%2F%2Fevil',
    );
    expect(recs[0].url).not.toContain('&callback=');
  });
});
