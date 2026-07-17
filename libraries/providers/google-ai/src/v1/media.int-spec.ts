import { describe, it, expect } from 'vitest';
import { googleaiMediaModule } from './media.adapter';

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

const json = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const bytes = (buf: Buffer, ok = true, status = 200) => ({
  ok,
  status,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  headers: { get: () => 'video/mp4' },
});

describe('google-ai media adapter (Gemini Developer API)', () => {
  it('Nano Banana image goes to :generateContent with the x-goog-api-key header and inline parts', async () => {
    const { recs, ctx } = makeCtx(() =>
      json({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } },
        ],
      }),
    );
    const adapter: any = googleaiMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a neon city', {
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash-image',
    });

    const r = recs[0];
    expect(r.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    );
    expect(r.method).toBe('POST');
    expect(r.headers['x-goog-api-key']).toBe('AIza-test');
    const body = JSON.parse(r.body);
    expect(body.contents).toEqual([{ parts: [{ text: 'a neon city' }] }]);
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(out.image).toBe('data:image/png;base64,QUJD');
  });

  it('Veo video → :predictLongRunning op name; pollJob downloads the auth-only file uri as a data URL', async () => {
    const mp4 = Buffer.from('VEOBYTES');
    const opName = 'models/veo-3.0-generate-001/operations/op-1';
    const { recs, ctx } = makeCtx((url, _i, n) => {
      if (url.endsWith(':predictLongRunning')) return json({ name: opName });
      if (url.includes('/operations/')) {
        return n <= 2
          ? json({ name: opName, done: false })
          : json({
              name: opName,
              done: true,
              response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gen/file' } }] } },
            });
      }
      return bytes(mp4); // the file uri download
    });
    const adapter: any = googleaiMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a waterfall', { apiKey: 'AIza-test', model: 'veo-3.0-generate-001' });
    expect(sub.jobId).toBe(opName);
    expect(recs[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning',
    );

    const pending = await adapter.pollJob(opName, { apiKey: 'AIza-test' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob(opName, { apiKey: 'AIza-test' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe(`data:video/mp4;base64,${mp4.toString('base64')}`);
  });

  it('Imagen image routes to :predict and decodes predictions[].bytesBase64Encoded', async () => {
    const { recs, ctx } = makeCtx(() =>
      json({ predictions: [{ bytesBase64Encoded: 'SU1H', mimeType: 'image/png' }] }),
    );
    const adapter: any = googleaiMediaModule.create(ctx as any);
    const out = await adapter.generateImage('a meadow', {
      apiKey: 'AIza-test',
      model: 'imagen-3.0-generate-002',
      input: { aspectRatio: '1:1' },
    });
    expect(recs[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict',
    );
    const body = JSON.parse(recs[0].body);
    expect(body.instances).toEqual([{ prompt: 'a meadow' }]);
    expect(body.parameters.aspectRatio).toBe('1:1');
    expect(out.image).toBe('data:image/png;base64,SU1H');
  });

  it('2.1: a 503 on the Veo operation poll THROWS (transient) — render not permanently failed', async () => {
    const { ctx } = makeCtx(() => json('busy', false, 503));
    const adapter: any = googleaiMediaModule.create(ctx as any);
    await expect(adapter.pollJob('models/veo/operations/op-1', { apiKey: 'AIza-test' })).rejects.toThrow(/transient/i);
  });

  it('2.1: a failed file download (post-success) THROWS — a paid render is not discarded', async () => {
    const opName = 'models/veo/operations/op-1';
    const { ctx } = makeCtx((url) => {
      if (url.includes('/operations/'))
        return json({ name: opName, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gen/file' } }] } } });
      return json('down', false, 500); // the file uri download
    });
    const adapter: any = googleaiMediaModule.create(ctx as any);
    // 2.2: a 5xx on the download leg is TRANSIENT → throws so the paid render is retried.
    await expect(adapter.pollJob(opName, { apiKey: 'AIza-test' })).rejects.toThrow(
      /download transient error 500/i,
    );

    // 2.2: a permanent 4xx on the download leg is TERMINAL → { status: 'failed' }.
    const { ctx: ctx4 } = makeCtx((url) => {
      if (url.includes('/operations/'))
        return json({ name: opName, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gen/file' } }] } } });
      return json('gone', false, 404);
    });
    const adapter4: any = googleaiMediaModule.create(ctx4 as any);
    expect((await adapter4.pollJob(opName, { apiKey: 'AIza-test' })).status).toBe('failed');
  });

  it('2.1: an operation error → returned failed; missing key on poll → terminal failed', async () => {
    const err = makeCtx(() => json({ name: 'op', done: true, error: { message: 'quota' } }));
    const a1: any = googleaiMediaModule.create(err.ctx as any);
    expect((await a1.pollJob('op', { apiKey: 'AIza-test' })).status).toBe('failed');

    const nokey = makeCtx(() => json({}));
    const a2: any = googleaiMediaModule.create(nokey.ctx as any);
    const r = await a2.pollJob('op', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Gemini API key/);
  });

  it('5.7: an oversize content-length on the file download is rejected before buffering', async () => {
    const opName = 'models/veo/operations/op-1';
    let buffered = false;
    const bigFile = {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? String(600 * 1024 * 1024) : 'video/mp4') },
      arrayBuffer: async () => {
        buffered = true;
        return new ArrayBuffer(8);
      },
    };
    const { ctx } = makeCtx((url) => {
      if (url.includes('/operations/'))
        return json({ name: opName, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gen/file' } }] } } });
      return bigFile;
    });
    const adapter: any = googleaiMediaModule.create(ctx as any);
    const r = await adapter.pollJob(opName, { apiKey: 'AIza-test' });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/size limit/);
    expect(buffered).toBe(false);
  });

  it('testConnection lists models; audio/avatar and missing key throw', async () => {
    const { recs, ctx } = makeCtx(() => json({ models: [] }));
    const adapter: any = googleaiMediaModule.create(ctx as any);
    const tc = await adapter.testConnection({ apiKey: 'AIza-test' });
    expect(tc.ok).toBe(true);
    expect(recs[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    await expect(adapter.generateAudio('x', { apiKey: 'AIza-test' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'AIza-test' })).rejects.toThrow();
    await expect(adapter.generateImage('x', {})).rejects.toThrow('Gemini API key');
  });
});
