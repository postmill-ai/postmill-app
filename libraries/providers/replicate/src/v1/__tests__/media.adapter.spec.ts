import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicateMediaAdapter } from '../media.adapter';

// Mock SafeFetchPort: the blocking (`Prefer: wait`) create returns a succeeded
// prediction immediately, so no polling leg is needed.
const makeFetch = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ id: 'pred-1', status: 'succeeded', output: 'https://example.com/img.png' }),
    text: () => Promise.resolve(''),
  });

const lastRequestBody = (fetchMock: ReturnType<typeof makeFetch>) =>
  JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body as string);

describe('ReplicateMediaAdapter.generateImage aspect mapping', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: ReplicateMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new ReplicateMediaAdapter(fetchMock as any);
  });

  it('maps the aspect hint to the flux aspect_ratio input', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-schnell',
      aspect: 'wide',
    });
    expect(lastRequestBody(fetchMock).input.aspect_ratio).toBe('16:9');

    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-schnell',
      aspect: 'tall',
    });
    expect(lastRequestBody(fetchMock).input.aspect_ratio).toBe('9:16');

    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-schnell',
      aspect: 'square',
    });
    expect(lastRequestBody(fetchMock).input.aspect_ratio).toBe('1:1');
  });

  it('lets an explicit input.aspect_ratio win over the hint', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-schnell',
      aspect: 'wide',
      input: { aspect_ratio: '3:2' },
    });
    expect(lastRequestBody(fetchMock).input.aspect_ratio).toBe('3:2');
  });

  it('omits aspect_ratio when no aspect is given', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-schnell',
    });
    expect(lastRequestBody(fetchMock).input.aspect_ratio).toBeUndefined();
  });

  it('reports the resolved model in the result metadata', async () => {
    // Callers persist this with the job; without it "which model painted
    // that?" can only be reverse-engineered from the adapter default.
    const explicit = await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-schnell',
    });
    expect(explicit.metadata).toMatchObject({
      model: 'black-forest-labs/flux-schnell',
    });

    const defaulted = await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
    });
    expect(defaulted.metadata).toMatchObject({
      model: 'black-forest-labs/flux-1.1-pro',
    });
  });

  it('defaults to flux-1.1-pro when no model is given (flux-schnell is retired upstream)', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
    });
    const url = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(url).toBe(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions'
    );
  });
});

describe('ReplicateMediaAdapter.generateImage image-to-image (sourceUrl)', () => {  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: ReplicateMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new ReplicateMediaAdapter(fetchMock as any);
  });

  it('routes sourceUrl into input_image for the flux-kontext family', async () => {
    await adapter.generateImage('make it a poster', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-kontext-pro',
      sourceUrl: 'data:image/jpeg;base64,QUJD',
    });
    const body = lastRequestBody(fetchMock);
    expect(body.input.input_image).toBe('data:image/jpeg;base64,QUJD');
    expect(body.input.prompt).toBe('make it a poster');
    expect(body.input.image).toBeUndefined();
  });

  it('routes sourceUrl into image for flux-dev (metadata-declared i2i)', async () => {
    await adapter.generateImage('make it a poster', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-dev',
      sourceUrl: 'https://cdn.example/ref.png',
    });
    const body = lastRequestBody(fetchMock);
    expect(body.input.image).toBe('https://cdn.example/ref.png');
    expect(body.input.input_image).toBeUndefined();
  });

  it('lets an explicit org tunable in options.input win over the mapping', async () => {
    await adapter.generateImage('make it a poster', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-kontext-pro',
      sourceUrl: 'https://cdn.example/ref.png',
      input: { input_image: 'https://cdn.example/override.png' },
    });
    expect(lastRequestBody(fetchMock).input.input_image).toBe(
      'https://cdn.example/override.png'
    );
  });

  it('throws for a text-to-image-only model rather than dropping the source', async () => {
    await expect(
      adapter.generateImage('a cat', {
        credentials: { apiKey: 'k' },
        model: 'black-forest-labs/flux-1.1-pro',
        sourceUrl: 'https://cdn.example/ref.png',
      })
    ).rejects.toThrow('does not accept image-to-image input');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no init-image field on the plain text-to-image path', async () => {
    await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-kontext-pro',
    });
    const body = lastRequestBody(fetchMock);
    expect(body.input.input_image).toBeUndefined();
    expect(body.input.image).toBeUndefined();
  });
});

const lastRequestUrl = (fetchMock: ReturnType<typeof makeFetch>) =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;

describe('ReplicateMediaAdapter.removeBackground model resolution', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: ReplicateMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new ReplicateMediaAdapter(fetchMock as any);
  });

  it('falls back to the live 851-labs/background-remover default (cjwbw/rembg is deleted upstream)', async () => {
    const url = await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
    });
    expect(url).toBe('https://example.com/img.png');
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/851-labs/background-remover/predictions'
    );
    expect(lastRequestBody(fetchMock).input).toEqual({ image: 'https://cdn.example.com/in.png' });
  });

  it('lets an org-configured options.model win over the default', async () => {
    await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
      model: 'bria/remove-background',
    });
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/bria/remove-background/predictions'
    );
  });

  it('lets an explicit options.version win over options.model', async () => {
    const hash = 'b'.repeat(64);
    await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
      model: 'bria/remove-background',
      version: hash,
    });
    expect(lastRequestUrl(fetchMock)).toBe('https://api.replicate.com/v1/predictions');
    expect(lastRequestBody(fetchMock).version).toBe(hash);
  });
});

describe('ReplicateMediaAdapter.removeBackground input field mapping', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: ReplicateMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new ReplicateMediaAdapter(fetchMock as any);
  });

  it('sends image_url for bria/remove-background (its metadata-declared input field)', async () => {
    await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
      model: 'bria/remove-background',
    });
    const body = lastRequestBody(fetchMock);
    expect(body.input.image_url).toBe('https://cdn.example.com/in.png');
    expect(body.input.image).toBeUndefined();
  });

  it('keeps the image field for the 851-labs/background-remover default', async () => {
    await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
    });
    expect(lastRequestBody(fetchMock).input).toEqual({ image: 'https://cdn.example.com/in.png' });
  });

  it('keeps the image field for an undeclared custom model', async () => {
    await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
      model: 'acme/custom-rembg',
    });
    expect(lastRequestBody(fetchMock).input).toEqual({ image: 'https://cdn.example.com/in.png' });
  });

  it('lets an explicit org tunable in options.input win over the mapping', async () => {
    await adapter.removeBackground('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
      model: 'bria/remove-background',
      input: { image_url: 'https://cdn.example.com/override.png' },
    });
    expect(lastRequestBody(fetchMock).input.image_url).toBe('https://cdn.example.com/override.png');
  });
});

describe('ReplicateMediaAdapter community-model 404 fallback', () => {
  const versionHash = 'a'.repeat(64);

  // /models/{slug}/predictions 404s for community models; the fallback is
  // GET /models/{slug} → latest_version.id → POST /predictions with `version`.
  const makeFallbackFetch = () => {
    const fn = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://api.replicate.com/v1/models/meta/musicgen/predictions') {
        return {
          ok: false,
          status: 404,
          text: () => Promise.resolve('{"detail":"The requested resource could not be found."}'),
        };
      }
      if (url === 'https://api.replicate.com/v1/models/meta/musicgen') {
        return {
          ok: true,
          json: () => Promise.resolve({ latest_version: { id: versionHash } }),
          text: () => Promise.resolve(''),
        };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ id: 'pred-community-1', status: 'starting' }),
        text: () => Promise.resolve(''),
      };
    });
    return fn;
  };

  it('falls back to the version-hash submission when the slug endpoint 404s', async () => {
    const fetchMock = makeFallbackFetch();
    const adapter = new ReplicateMediaAdapter(fetchMock as any);

    const submission = await adapter.generateAudio('upbeat jazz', {
      credentials: { apiKey: 'k' },
      model: 'meta/musicgen',
    });

    expect(submission).toEqual({ jobId: 'pred-community-1' });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.replicate.com/v1/models/meta/musicgen/predictions',
      'https://api.replicate.com/v1/models/meta/musicgen',
      'https://api.replicate.com/v1/predictions',
    ]);
    const body = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(body.version).toBe(versionHash);
    expect(body.input.prompt).toBe('upbeat jazz');
  });

  it('keeps the fast path for official models (no version lookup when the slug POST succeeds)', async () => {
    const fetchMock = makeFetch();
    const adapter = new ReplicateMediaAdapter(fetchMock as any);

    await adapter.generateAudio('upbeat jazz', {
      credentials: { apiKey: 'k' },
      model: 'official/music-model',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.replicate.com/v1/models/official/music-model/predictions'
    );
  });

  it('does not fall back on non-404 errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"detail":"invalid input"}'),
    });
    const adapter = new ReplicateMediaAdapter(fetchMock as any);

    await expect(
      adapter.generateAudio('upbeat jazz', {
        credentials: { apiKey: 'k' },
        model: 'meta/musicgen',
      })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces the lookup error when the model is truly gone (404 on both legs)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"detail":"not found"}'),
    });
    const adapter = new ReplicateMediaAdapter(fetchMock as any);

    await expect(
      adapter.generateAudio('upbeat jazz', {
        credentials: { apiKey: 'k' },
        model: 'meta/gone',
      })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ReplicateMediaAdapter.upscaleImage / inpaintImage model resolution', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: ReplicateMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new ReplicateMediaAdapter(fetchMock as any);
  });

  it('upscaleImage honors options.model and defaults to nightmareai/real-esrgan', async () => {
    await adapter.upscaleImage('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
      model: 'philz1337x/clarity-upscaler',
    });
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/philz1337x/clarity-upscaler/predictions'
    );

    await adapter.upscaleImage('https://cdn.example.com/in.png', {
      credentials: { apiKey: 'k' },
    });
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions'
    );
  });

  it('inpaintImage honors options.model and defaults to stable-diffusion-inpainting', async () => {
    await adapter.inpaintImage('https://cdn.example.com/in.png', 'https://cdn.example.com/mask.png', 'fill', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-fill-pro',
    });
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-fill-pro/predictions'
    );

    await adapter.inpaintImage('https://cdn.example.com/in.png', 'https://cdn.example.com/mask.png', 'fill', {
      credentials: { apiKey: 'k' },
    });
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/stability-ai/stable-diffusion-inpainting/predictions'
    );
  });
});

describe('ReplicateMediaAdapter.outpaintImage (flux-fill-pro)', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
  let adapter: ReplicateMediaAdapter;

  beforeEach(() => {
    fetchMock = makeFetch();
    adapter = new ReplicateMediaAdapter(fetchMock as any);
  });

  it('declares the outpaint capability', () => {
    expect(adapter.capabilities.outpaint).toBe(true);
  });

  it('defaults to flux-fill-pro and maps the canonical mode onto the outpaint input', async () => {
    const url = await adapter.outpaintImage('https://cdn.example.com/in.png', 'zoom-2x', undefined, {
      credentials: { apiKey: 'k' },
    });
    expect(url).toBe('https://example.com/img.png');
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/black-forest-labs/flux-fill-pro/predictions'
    );
    expect(lastRequestBody(fetchMock).input).toEqual({
      image: 'https://cdn.example.com/in.png',
      outpaint: 'Zoom out 2x',
      prompt: expect.stringContaining('Extend the image naturally'),
    });
  });

  it('maps every canonical mode to its flux-fill-pro token', async () => {
    const tokens: Record<string, string> = {
      'zoom-1.5x': 'Zoom out 1.5x',
      'zoom-2x': 'Zoom out 2x',
      'make-square': 'Make square',
      left: 'Left outpaint',
      right: 'Right outpaint',
      top: 'Top outpaint',
      bottom: 'Bottom outpaint',
    };
    for (const [mode, token] of Object.entries(tokens)) {
      await adapter.outpaintImage('https://cdn.example.com/in.png', mode as any, undefined, {
        credentials: { apiKey: 'k' },
      });
      expect(lastRequestBody(fetchMock).input.outpaint).toBe(token);
    }
  });

  // flux-fill-pro marks `prompt` required (live 422 when omitted), so a prompt-less
  // outpaint must send the seamless-extension default, not drop the field.
  it('sends the seamless-extension default prompt when none is supplied', async () => {
    await adapter.outpaintImage('https://cdn.example.com/in.png', 'zoom-1.5x', undefined, {
      credentials: { apiKey: 'k' },
    });
    expect(lastRequestBody(fetchMock).input.prompt).toBe(
      'Extend the image naturally beyond its borders, seamlessly matching the existing style, lighting, colors, and content.'
    );

    await adapter.outpaintImage('https://cdn.example.com/in.png', 'zoom-1.5x', '   ', {
      credentials: { apiKey: 'k' },
    });
    expect(lastRequestBody(fetchMock).input.prompt).toBe(
      'Extend the image naturally beyond its borders, seamlessly matching the existing style, lighting, colors, and content.'
    );
  });

  it('lets an explicit prompt win over the default', async () => {
    await adapter.outpaintImage('https://cdn.example.com/in.png', 'left', 'more ocean', {
      credentials: { apiKey: 'k' },
    });
    expect(lastRequestBody(fetchMock).input).toEqual({
      image: 'https://cdn.example.com/in.png',
      outpaint: 'Left outpaint',
      prompt: 'more ocean',
    });
  });

  it('honors options.model over the default, and options.version over both', async () => {
    await adapter.outpaintImage('https://cdn.example.com/in.png', 'make-square', undefined, {
      credentials: { apiKey: 'k' },
      model: 'acme/custom-fill',
    });
    expect(lastRequestUrl(fetchMock)).toBe(
      'https://api.replicate.com/v1/models/acme/custom-fill/predictions'
    );

    const hash = 'c'.repeat(64);
    await adapter.outpaintImage('https://cdn.example.com/in.png', 'make-square', undefined, {
      credentials: { apiKey: 'k' },
      model: 'acme/custom-fill',
      version: hash,
    });
    expect(lastRequestUrl(fetchMock)).toBe('https://api.replicate.com/v1/predictions');
    expect(lastRequestBody(fetchMock).version).toBe(hash);
  });

  it('lets an explicit org tunable in options.input win over the mode mapping', async () => {
    await adapter.outpaintImage('https://cdn.example.com/in.png', 'zoom-1.5x', undefined, {
      credentials: { apiKey: 'k' },
      input: { outpaint: 'Right outpaint' },
    });
    expect(lastRequestBody(fetchMock).input.outpaint).toBe('Right outpaint');
  });
});


describe('ReplicateMediaAdapter object outputs (named artifacts)', () => {
  const fetchReturning = (body: unknown) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });

  const pollWith = async (output: unknown) => {
    const fetchMock = fetchReturning({ id: 'pred-1', status: 'succeeded', output });
    const adapter = new ReplicateMediaAdapter(fetchMock as any);
    return adapter.pollJob('pred-1', { credentials: { apiKey: 'k' } });
  };

  it('picks the audio URL from a { audio, spectrogram } object (prod regression cmvfsa458000jsynvm3hc2380)', async () => {
    // riffusion/riffusion succeeded but the job failed "Replicate prediction
    // succeeded without output" — its output is an OBJECT (prediction
    // 2er3whyxd9rga0d1argbx16ed0):
    //   { audio: "https://replicate.delivery/.../gen_sound.wav",
    //     spectrogram: "https://replicate.delivery/.../spectrogram.jpg" }
    const result = await pollWith({
      audio: 'https://replicate.delivery/gen_sound.wav',
      spectrogram: 'https://replicate.delivery/spectrogram.jpg',
    });
    expect(result).toMatchObject({
      status: 'completed',
      artifactUrl: 'https://replicate.delivery/gen_sound.wav',
    });
  });

  it('prefers the video key over thumbnails', async () => {
    const result = await pollWith({
      thumbnail: 'https://replicate.delivery/thumb.jpg',
      video: 'https://replicate.delivery/out.mp4',
    });
    expect(result).toMatchObject({
      status: 'completed',
      artifactUrl: 'https://replicate.delivery/out.mp4',
    });
  });

  it('falls back to a fuzzy key match, then the first string value', async () => {
    const fuzzy = await pollWith({ output_url: 'https://replicate.delivery/a.wav', other: 42 });
    expect(fuzzy).toMatchObject({ status: 'completed', artifactUrl: 'https://replicate.delivery/a.wav' });

    const firstString = await pollWith({ whatever: 'https://replicate.delivery/b.png', count: 3 });
    expect(firstString).toMatchObject({ status: 'completed', artifactUrl: 'https://replicate.delivery/b.png' });
  });

  it('keeps the "succeeded without output" failure for empty objects / no string values', async () => {
    expect(await pollWith({})).toMatchObject({
      status: 'failed',
      error: 'Replicate prediction succeeded without output',
    });
    expect(await pollWith({ audio: '', count: 3 })).toMatchObject({
      status: 'failed',
      error: 'Replicate prediction succeeded without output',
    });
  });

  it('keeps string and string[] outputs unchanged', async () => {
    expect(await pollWith('https://replicate.delivery/single.png')).toMatchObject({
      status: 'completed',
      artifactUrl: 'https://replicate.delivery/single.png',
    });
    expect(
      await pollWith(['https://replicate.delivery/first.png', 'https://replicate.delivery/second.png'])
    ).toMatchObject({ status: 'completed', artifactUrl: 'https://replicate.delivery/first.png' });
  });

  it('resolves object outputs on the sync image path too (generateImage)', async () => {
    const fetchMock = fetchReturning({
      id: 'pred-1',
      status: 'succeeded',
      output: { image: 'https://replicate.delivery/out.png', mask: 'https://replicate.delivery/mask.png' },
    });
    const adapter = new ReplicateMediaAdapter(fetchMock as any);
    const result = await adapter.generateImage('a cat', {
      credentials: { apiKey: 'k' },
      model: 'black-forest-labs/flux-1.1-pro',
    });
    expect(result).toMatchObject({
      multi: false,
      image: 'https://replicate.delivery/out.png',
      images: ['https://replicate.delivery/out.png'],
    });
  });
});
