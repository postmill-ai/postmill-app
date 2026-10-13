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

describe('ReplicateMediaAdapter.generateImage image-to-image (sourceUrl)', () => {
  let fetchMock: ReturnType<typeof makeFetch>;
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
