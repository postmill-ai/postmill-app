import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenaiMediaAdapter } from '../media.adapter';

// Mock SafeFetchPort: captures the request body and returns a minimal OK
// images/generations response.
const makeFetch = () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: [{ url: 'https://example.com/img.png' }] }),
    text: () => Promise.resolve(''),
  });
  return fetchMock;
};

const lastRequestBody = (fetchMock: ReturnType<typeof makeFetch>) =>
  JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body as string);

describe('OpenaiMediaAdapter.generateImage aspect mapping', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: OpenaiMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new OpenaiMediaAdapter(fetchMock as any);
  });

  it('maps wide/tall to gpt-image sizes for gpt-image models', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'gpt-image-1',
      aspect: 'wide',
    });
    expect(lastRequestBody(fetchMock).size).toBe('1536x1024');

    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'gpt-image-1',
      aspect: 'tall',
    });
    expect(lastRequestBody(fetchMock).size).toBe('1024x1536');
  });

  it('maps wide/tall to the dall-e sizes for dall-e models', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'dall-e-3',
      aspect: 'wide',
    });
    expect(lastRequestBody(fetchMock).size).toBe('1792x1024');

    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'dall-e-3',
      aspect: 'tall',
    });
    expect(lastRequestBody(fetchMock).size).toBe('1024x1792');
  });

  it('lets an explicit size win over the aspect hint', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'gpt-image-1',
      size: '1024x1024',
      aspect: 'wide',
    });
    expect(lastRequestBody(fetchMock).size).toBe('1024x1024');
  });

  it('keeps the 1024x1024 default when no aspect is given', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'gpt-image-1',
    });
    expect(lastRequestBody(fetchMock).size).toBe('1024x1024');
  });

  it('defaults to gpt-image-1 with quality "auto" (dall-e-3 is gone for new keys)', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
    });
    const body = lastRequestBody(fetchMock);
    expect(body.model).toBe('gpt-image-1');
    // 'standard' is dall-e-only and 400s on gpt-image-1 (auto|high|medium|low).
    expect(body.quality).toBe('auto');
  });

  it('keeps the dall-e quality default for an explicit dall-e-3 override', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'dall-e-3',
    });
    const body = lastRequestBody(fetchMock);
    expect(body.model).toBe('dall-e-3');
    expect(body.quality).toBe('standard');
  });

  it('lets an explicit quality (top-level or native input) win over the model default', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'gpt-image-1',
      quality: 'high',
    });
    expect(lastRequestBody(fetchMock).quality).toBe('high');

    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'gpt-image-1',
      input: { quality: 'low' },
    });
    expect(lastRequestBody(fetchMock).quality).toBe('low');
  });
});

describe('OpenaiMediaAdapter TTS', () => {
  // TTS reads the body as an ArrayBuffer, not JSON.
  const makeTtsFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      text: () => Promise.resolve(''),
    });

  it('lists the gpt-4o-mini-tts voices (ballad, coral) alongside the tts-1 set', async () => {
    const adapter = new OpenaiMediaAdapter(makeTtsFetch() as any);
    const voices = await adapter.listVoices();
    const ids = voices.map((v) => v.id);
    for (const id of ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'sage', 'ash', 'ballad', 'coral']) {
      expect(ids).toContain(id);
    }
    expect(voices).toHaveLength(10);
  });

  it('sends instructions only for gpt-4o-mini-tts', async () => {
    const fetchMock = makeTtsFetch();
    const adapter = new OpenaiMediaAdapter(fetchMock as any);

    await adapter.textToSpeech('hello', {
      credentials: { apiKey: 'k' },
      model: 'gpt-4o-mini-tts',
      instructions: 'Speak warmly and slowly',
    });
    expect(lastRequestBody(fetchMock).instructions).toBe('Speak warmly and slowly');

    // tts-1 rejects the unknown field upstream — never send it there.
    await adapter.textToSpeech('hello', {
      credentials: { apiKey: 'k' },
      model: 'tts-1',
      instructions: 'Speak warmly and slowly',
    });
    expect(lastRequestBody(fetchMock)).not.toHaveProperty('instructions');

    await adapter.textToSpeech('hello', {
      credentials: { apiKey: 'k' },
      model: 'tts-1-hd',
      instructions: 'Speak warmly and slowly',
    });
    expect(lastRequestBody(fetchMock)).not.toHaveProperty('instructions');
  });

  it('reads instructions from the studio descriptor input too', async () => {
    const fetchMock = makeTtsFetch();
    const adapter = new OpenaiMediaAdapter(fetchMock as any);

    await adapter.textToSpeech('hello', {
      credentials: { apiKey: 'k' },
      model: 'gpt-4o-mini-tts',
      input: { instructions: 'Cheerful' },
    });
    expect(lastRequestBody(fetchMock).instructions).toBe('Cheerful');
  });

  it('omits instructions entirely when none are given', async () => {
    const fetchMock = makeTtsFetch();
    const adapter = new OpenaiMediaAdapter(fetchMock as any);

    await adapter.textToSpeech('hello', {
      credentials: { apiKey: 'k' },
      model: 'gpt-4o-mini-tts',
    });
    expect(lastRequestBody(fetchMock)).not.toHaveProperty('instructions');
  });
});
