import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { minimaxMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. MiniMax: image + audio are
// synchronous; video is async submit (/video_generation → task_id) then poll
// (/query/video_generation → Success + file_id → /files/retrieve → download_url).

describe('minimax media adapter', () => {
  it('exposes S2V-01 in the image-to-video catalog used by backend validation', () => {
    const models = minimaxMediaModule.metadata.mediaModels?.['image-to-video'] || [];
    expect(models.some((model) => model.id === 'S2V-01')).toBe(true);
  });

  it('submits video generation to /video_generation with Bearer auth and folds subject_image into subject_reference', async () => {
    const { recs, ctx } = makeCtx(() => res({ task_id: 'task-123' }));
    const adapter: any = minimaxMediaModule.create(ctx as any);

    const sub = await adapter.generateVideo('a cat surfing', {
      apiKey: 'minimax-key',
      model: 'S2V-01',
      webhookUrl: 'https://backend.example/media-jobs/webhook/job-1/tok',
      input: { prompt_optimizer: true, subject_image: 'https://img/me.png' },
    });

    expect(sub.jobId).toBe('task-123');
    const r = recs[0];
    expect(r.ipFamily).toBe(4);
    expect(r.url).toBe('https://api.minimax.io/v1/video_generation');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer minimax-key');
    const body = JSON.parse(r.body);
    expect(body.model).toBe('S2V-01');
    expect(body.prompt).toBe('a cat surfing');
    expect(body.prompt_optimizer).toBe(true);
    // MiniMax rejects callback URLs it can't challenge-verify, so webhookUrl is never
    // forwarded; polling covers completion.
    expect(body.callback_url).toBeUndefined();
    // subject_image is flattened into MiniMax's nested subject_reference array.
    expect(body.subject_reference).toEqual([{ type: 'character', image: ['https://img/me.png'] }]);
  });

  it('maps the generic image-to-video sourceUrl onto the S2V subject reference', async () => {
    const { recs, ctx } = makeCtx(() => res({ task_id: 'task-s2v' }));
    const adapter: any = minimaxMediaModule.create(ctx as any);

    await adapter.generateVideo('the presenter holds a coffee cup', {
      apiKey: 'minimax-key',
      model: 'S2V-01',
      sourceUrl: 'https://img/presenter.png',
    });

    const body = JSON.parse(recs[0].body);
    expect(body.model).toBe('S2V-01');
    expect(body.subject_reference).toEqual([
      { type: 'character', image: ['https://img/presenter.png'] },
    ]);

    await adapter.generateVideo('animate the product', {
      apiKey: 'minimax-key',
      model: 'I2V-01',
      sourceUrl: 'https://img/product.png',
    });
    expect(JSON.parse(recs[1].body).subject_reference).toBeUndefined();
  });

  it('generateImage POSTs to /image_generation and parses data.image_urls', async () => {
    const { recs, ctx } = makeCtx(() =>
      res({ data: { image_urls: ['https://cdn.minimax/a.png', 'https://cdn.minimax/b.png'] } }),
    );
    const adapter: any = minimaxMediaModule.create(ctx as any);

    const out = await adapter.generateImage('a logo', { apiKey: 'minimax-key', model: 'image-01' });
    const r = recs[0];
    expect(r.ipFamily).toBe(4);
    expect(r.url).toBe('https://api.minimax.io/v1/image_generation');
    expect(r.method).toBe('POST');
    const body = JSON.parse(r.body);
    expect(body.prompt).toBe('a logo');
    expect(body.response_format).toBe('url');
    expect(out.image).toBe('https://cdn.minimax/a.png');
    expect(out.multi).toBe(true);
  });

  it('pollJob parses pending then Success (query → files/retrieve → download_url)', async () => {
    const { recs, ctx } = makeCtx((url, _i, n) => {
      if (url.includes('query/video_generation')) {
        return n === 1
          ? res({ status: 'Processing' })
          : res({ status: 'Success', file_id: 'file-9' });
      }
      // files/retrieve
      return res({ file: { download_url: 'https://cdn.minimax/out.mp4' } });
    });
    const adapter: any = minimaxMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('task-123', { apiKey: 'minimax-key' });
    expect(pending.status).toBe('pending');

    const done = await adapter.pollJob('task-123', { apiKey: 'minimax-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.minimax/out.mp4');
    expect(recs).toHaveLength(3);
    expect(recs.every((r) => r.ipFamily === 4)).toBe(true);
  });

  it('rejects unsupported avatar and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = minimaxMediaModule.create(ctx as any);
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', {})).rejects.toThrow('API key is required');
  });

  // 3.4 — the query poll leg throws on a transient error (still-rendering job retries).
  it('pollJob throws on a 503 query response', async () => {
    const { ctx } = makeCtx(() => res('overloaded', false, 503));
    const adapter: any = minimaxMediaModule.create(ctx as any);
    await expect(adapter.pollJob('task-1', { apiKey: 'minimax-key' })).rejects.toThrow(/transient/);
  });

  // 3.4 — MiniMax's second window: the render SUCCEEDED but the files/retrieve leg 429s. That
  // must retry (throw), not permanently fail a completed generation.
  it('pollJob throws when files/retrieve returns a transient error after Success', async () => {
    const { ctx } = makeCtx((url) =>
      url.includes('/query/')
        ? res({ status: 'Success', file_id: 'file-9' })
        : res('rate limited', false, 429),
    );
    const adapter: any = minimaxMediaModule.create(ctx as any);
    await expect(adapter.pollJob('task-1', { apiKey: 'minimax-key' })).rejects.toThrow(/file retrieve transient/);
  });

  it('pollJob returns failed on a terminal 400 and when the key is missing', async () => {
    const { ctx: ctx4 } = makeCtx(() => res('bad', false, 400));
    const out = await (minimaxMediaModule.create(ctx4 as any) as any).pollJob('t', { apiKey: 'minimax-key' });
    expect(out.status).toBe('failed');
    const { ctx: ctxNoKey } = makeCtx(() => res({}));
    const noKey = await (minimaxMediaModule.create(ctxNoKey as any) as any).pollJob('t', {});
    expect(noKey.status).toBe('failed');
  });

  // 6.1e — malformed (non-hex) sync audio is rejected rather than silently corrupted.
  it('generateAudio rejects a non-hex audio payload', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: { audio: 'nothex!!' } }));
    const adapter: any = minimaxMediaModule.create(ctx as any);
    await expect(adapter.generateAudio('hello', { apiKey: 'minimax-key' })).rejects.toThrow(/malformed/);
    expect(recs[0].ipFamily).toBe(4);
  });

  // Free connection test — hits the /models list, never a billed render.
  it('testConnection GETs /models with Bearer auth and reports ok', async () => {
    const { recs, ctx } = makeCtx(() => res({ object: 'list', data: [] }));
    const adapter: any = minimaxMediaModule.create(ctx as any);

    const out = await adapter.testConnection({ credentials: { apiKey: 'minimax-key' } });
    expect(out).toEqual({ ok: true, message: 'Connection successful' });
    const r = recs[0];
    expect(r.ipFamily).toBe(4);
    expect(r.url).toBe('https://api.minimax.io/v1/models');
    expect(r.method ?? 'GET').toBe('GET');
    expect(r.headers.Authorization).toBe('Bearer minimax-key');
  });

  it('testConnection maps 401/403 to Invalid API key and requires a key', async () => {
    const { ctx } = makeCtx(() => res('unauthorized', false, 401));
    const adapter: any = minimaxMediaModule.create(ctx as any);
    expect(await adapter.testConnection({ credentials: { apiKey: 'bad' } })).toEqual({
      ok: false,
      message: 'Invalid API key',
    });
    expect(await adapter.testConnection({ credentials: {} })).toEqual({
      ok: false,
      message: 'MiniMax API key is required',
    });
  });

  it.each([
    ['video', (adapter: any) => adapter.generateVideo('a product ad', { apiKey: 'k' })],
    ['image', (adapter: any) => adapter.generateImage('a product photo', { apiKey: 'k' })],
    ['audio', (adapter: any) => adapter.generateAudio('a product jingle', { apiKey: 'k' })],
  ] as const)('classifies an embedded %s balance failure as a non-retryable upstream quota error', async (operation, generate) => {
    const { ctx } = makeCtx(() => res({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }));
    const adapter: any = minimaxMediaModule.create(ctx as any);

    const error = await generate(adapter).catch((err: unknown) => err);
    expect(error).toMatchObject({
      name: 'ProviderUpstreamError',
      kind: 'quota',
      retryable: false,
      upstreamStatus: undefined,
    });
    expect(error.message).toBe(`MiniMax reports the account's quota or billing limit was reached: insufficient balance`);
    expect(error.ctx.operation).toBe(operation);
  });

  it('keeps a missing result without a provider error message as an application error', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = minimaxMediaModule.create(ctx as any);

    const error = await adapter.generateVideo('a product ad', { apiKey: 'k' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('Error');
    expect(error.message).toBe('MiniMax returned no task id: unknown error');
  });
});
