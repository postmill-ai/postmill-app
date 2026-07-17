import { describe, it, expect } from 'vitest';
import { leonardoMediaModule } from './media.adapter';

// Leonardo.ai has no separate pollJob — generateImage submits then bounded-internal-polls the
// async generation to keep the synchronous image contract. We exercise create → COMPLETE here.

interface Rec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function makeCtx(handler: (url: string, init: any, n: number) => any) {
  const recs: Rec[] = [];
  const fetch = async (input: any, init: any = {}) => {
    recs.push({
      url: String(input),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
    });
    return handler(String(input), init, recs.length);
  };
  return {
    recs,
    ctx: {
      credentials: {},
      encryption: { encrypt: (v: string) => v, decrypt: (v: string) => v },
      fetch: fetch as any,
      logger: { log() {}, warn() {}, error() {}, debug() {} },
      telemetry: { recordCall() {} },
    },
  };
}

const res = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('leonardo media adapter (create + bounded internal poll)', () => {
  it('POSTs /generations with prompt+modelId then polls the generation to COMPLETE and parses image urls', async () => {
    const { recs, ctx } = makeCtx((url) => {
      if (url.endsWith('/generations')) return res({ sdGenerationJob: { generationId: 'gen-1' } });
      // GET /generations/{id}
      return res({
        generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://leo/out.png', id: 'img-1' }] },
      });
    });
    const adapter: any = leonardoMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a fox in snow', {
      apiKey: 'leo-key',
      model: 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3',
      input: { width: 1024, height: 768, num_images: 1 },
    });

    const create = recs[0];
    expect(create.url).toBe('https://cloud.leonardo.ai/api/rest/v1/generations');
    expect(create.method).toBe('POST');
    expect(create.headers.Authorization).toBe('Bearer leo-key');
    const body = JSON.parse(create.body);
    expect(body.prompt).toBe('a fox in snow');
    expect(body.modelId).toBe('de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3');
    expect(body.width).toBe(1024);
    expect(body.height).toBe(768);

    // poll GET hit and artifact parsed
    expect(recs.some((r) => r.url === 'https://cloud.leonardo.ai/api/rest/v1/generations/gen-1')).toBe(true);
    expect(out.image).toBe('https://leo/out.png');
    expect(out.images).toEqual(['https://leo/out.png']);
  }, 15000);

  it('throws on FAILED generation status', async () => {
    const { ctx } = makeCtx((url) =>
      url.endsWith('/generations')
        ? res({ sdGenerationJob: { generationId: 'gen-2' } })
        : res({ generations_by_pk: { status: 'FAILED' } }),
    );
    const adapter: any = leonardoMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', { apiKey: 'leo-key' })).rejects.toThrow('failed');
  }, 15000);

  it('rejects video/audio/avatar (unsupported) and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = leonardoMediaModule.create(ctx as any);
    await expect(adapter.generateVideo('x', { apiKey: 'leo-key' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', { apiKey: 'leo-key' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'leo-key' })).rejects.toThrow();
    await expect(adapter.generateImage('x', {})).rejects.toThrow('API key is required');
  });
});
