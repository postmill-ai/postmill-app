import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { openaiMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. The Sora video paths are covered
// in sora.int-spec.ts; this spec pins the free testConnection probe (the settings Test button
// must never fall back to a billed image render).

describe('openai media adapter testConnection', () => {
  it('GETs /v1/models with Bearer auth — 200 ok, 401 Invalid API key, 500 throws, missing key', async () => {
    const okCtx = makeCtx(() => res({ data: [] }));
    const a1: any = openaiMediaModule.create(okCtx.ctx as any);
    expect(await a1.testConnection({ apiKey: 'sk-test' })).toEqual({ ok: true, message: 'Connection successful' });
    expect(okCtx.recs[0].url).toBe('https://api.openai.com/v1/models');
    expect(okCtx.recs[0].method).toBe('GET');
    expect(okCtx.recs[0].headers.Authorization).toBe('Bearer sk-test');

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a2: any = openaiMediaModule.create(bad.ctx as any);
    expect(await a2.testConnection({ apiKey: 'wrong' })).toEqual({ ok: false, message: 'Invalid API key' });

    const err = makeCtx(() => res('boom', false, 500));
    const a3: any = openaiMediaModule.create(err.ctx as any);
    await expect(a3.testConnection({ apiKey: 'sk-test' })).rejects.toThrow(/connection test failed \(500\)/);

    const noKey = makeCtx(() => res({}));
    const a4: any = openaiMediaModule.create(noKey.ctx as any);
    expect(await a4.testConnection({})).toEqual({ ok: false, message: 'OpenAI API key is required' });
    expect(noKey.recs).toHaveLength(0);
  });
});
