import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { sunoMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4 / ENHANCEMENTS_3 workstream E) — no network. A stub
// fetch records the request the adapter builds and returns canned responses matching sunoapi.org's
// documented shape. Suno is async: POST /api/v1/generate → taskId, then poll
// GET /api/v1/generate/record-info?taskId=… → data.response.sunoData[].audioUrl (2 clips).
//
// UNVERIFIED vs live key: the status-string set (SUCCESS / *FAILED*) and the sunoData[].audioUrl
// path are grounded in the docs, not a live response — smoke-test against a real key.

describe('suno media adapter (sunoapi.org async music)', () => {
  it('submits non-custom generation (prompt only) with Bearer auth and the mandatory envelope', async () => {
    const { recs, ctx } = makeCtx(() => res({ code: 200, msg: 'success', data: { taskId: 'task-abc' } }));
    const adapter: any = sunoMediaModule.create(ctx as any);

    const sub = await adapter.generateAudio('an upbeat synthwave track', {
      apiKey: 'suno-key',
      model: 'V5',
      input: { instrumental: false },
    });

    expect(sub.jobId).toBe('task-abc');
    const r = recs[0];
    expect(r.url).toBe('https://api.sunoapi.org/api/v1/generate');
    expect(r.method).toBe('POST');
    expect(r.headers.Authorization).toBe('Bearer suno-key');
    const body = JSON.parse(r.body);
    expect(body.customMode).toBe(false); // no style+title → non-custom
    expect(body.instrumental).toBe(false);
    expect(body.model).toBe('V5');
    expect(body.prompt).toBe('an upbeat synthwave track');
    expect(body.callBackUrl).toBe(''); // polling-only
    expect(body.style).toBeUndefined();
    expect(body.title).toBeUndefined();
  });

  it('enables customMode only when both style and title are present, and passes them through', async () => {
    const { recs, ctx } = makeCtx(() => res({ data: { taskId: 'task-def' } }));
    const adapter: any = sunoMediaModule.create(ctx as any);

    await adapter.generateAudio('soft piano lullaby', {
      apiKey: 'suno-key',
      model: 'V5_5',
      input: { style: 'Classical', title: 'Night Rain', instrumental: true, styleWeight: 0.65 },
    });

    const body = JSON.parse(recs[0].body);
    expect(body.customMode).toBe(true);
    expect(body.instrumental).toBe(true);
    expect(body.style).toBe('Classical');
    expect(body.title).toBe('Night Rain');
    expect(body.styleWeight).toBe(0.65); // native passthrough
  });

  it('pollJob parses PENDING → pending and SUCCESS → completed with both clips (extraArtifactUrls)', async () => {
    const { recs, ctx } = makeCtx((_url, _init, n) =>
      n === 1
        ? res({ data: { status: 'PENDING' } })
        : res({
            data: {
              status: 'SUCCESS',
              response: {
                sunoData: [
                  { id: 'a', audioUrl: 'https://cdn.suno/a.mp3', title: 'Take 1', duration: 198.4 },
                  { id: 'b', audioUrl: 'https://cdn.suno/b.mp3', title: 'Take 2', duration: 201.1 },
                ],
              },
            },
          }),
    );
    const adapter: any = sunoMediaModule.create(ctx as any);

    const pending = await adapter.pollJob('task-abc', { apiKey: 'suno-key' });
    expect(pending.status).toBe('pending');
    expect(recs[0].url).toBe('https://api.sunoapi.org/api/v1/generate/record-info?taskId=task-abc');

    const done = await adapter.pollJob('task-abc', { apiKey: 'suno-key' });
    expect(done.status).toBe('completed');
    expect(done.artifactUrl).toBe('https://cdn.suno/a.mp3');
    expect(done.extraArtifactUrls).toEqual(['https://cdn.suno/b.mp3']);
    expect(done.metadata?.mime).toBe('audio/mpeg');
  });

  it('pollJob maps a *FAILED* status to failed', async () => {
    const { ctx } = makeCtx(() => res({ data: { status: 'GENERATE_AUDIO_FAILED' } }));
    const adapter: any = sunoMediaModule.create(ctx as any);
    const r = await adapter.pollJob('task-abc', { apiKey: 'suno-key' });
    expect(r.status).toBe('failed');
  });

  it('2.1: a 503 on poll THROWS (transient); missing key on poll → terminal failed', async () => {
    const t = makeCtx(() => res('busy', false, 503));
    const a1: any = sunoMediaModule.create(t.ctx as any);
    await expect(a1.pollJob('task-abc', { apiKey: 'suno-key' })).rejects.toThrow(/transient/i);

    const nokey = makeCtx(() => res({}));
    const a2: any = sunoMediaModule.create(nokey.ctx as any);
    const r = await a2.pollJob('task-abc', {});
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/key is required/);
  });

  it('2.1: a 4xx on poll → returned failed (not thrown)', async () => {
    const { ctx } = makeCtx(() => res('bad', false, 404));
    const adapter: any = sunoMediaModule.create(ctx as any);
    expect((await adapter.pollJob('task-abc', { apiKey: 'k' })).status).toBe('failed');
  });

  it('5.6: testConnection rejects a 5xx as NOT connected', async () => {
    const { ctx } = makeCtx(() => res('down', false, 500));
    const adapter: any = sunoMediaModule.create(ctx as any);
    expect((await adapter.testConnection({ apiKey: 'k' })).ok).toBe(false);
  });

  it('rejects unsupported image/video/avatar and a missing key', async () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = sunoMediaModule.create(ctx as any);
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow();
    await expect(adapter.generateAudio('x', {})).rejects.toThrow('API key is required');
  });
});
