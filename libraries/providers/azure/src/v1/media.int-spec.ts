import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@postmill-ai/provider-kernel/testing/media-int-helpers';
import { azureMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. Azure OpenAI does NOT build a raw
// HTTP request through ctx.fetch: image generation is delegated to the matching AI Azure
// adapter via the AI-SDK media bridge (`generateImageViaAiSdk`), which resolves an injected
// AIProviderRegistry and runs `@ai-sdk/azure` (Azure deployment auth). A fetch-recording test
// therefore cannot capture the request body, so we assert only what is honestly verifiable
// without a live key / registry: manifest + capability metadata, the no-model guard, the
// registry-absent delegation guard, and the unsupported-operation rejections.

describe('azure media adapter (AI-SDK delegation)', () => {
  it('exposes image-only capabilities and a correct manifest', () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = azureMediaModule.create(ctx as any);
    expect(adapter.identifier).toBe('azure');
    expect(adapter.name).toBe('Azure OpenAI');
    expect(adapter.capabilities.image).toBe(true);
    expect(adapter.capabilities.video).toBe(false);
    expect(adapter.capabilities.audio).toBe(false);
    expect(adapter.capabilities.avatar).toBe(false);

    expect(azureMediaModule.manifest.domain).toBe('media');
    expect(azureMediaModule.manifest.providerId).toBe('azure');
    expect(azureMediaModule.manifest.version).toBe('v1');
    expect(azureMediaModule.manifest.displayName).toBe('Azure OpenAI');
    expect(azureMediaModule.manifest.status).toBe('active');
  });

  it('guards a missing model, delegates image generation through the AI registry (not ctx.fetch), and rejects unsupported operations', async () => {
    const { recs, ctx } = makeCtx(() => res({}));
    const adapter: any = azureMediaModule.create(ctx as any);

    // No model → fails the base-class guard before any delegation.
    await expect(adapter.generateImage('x', { apiKey: 'k' })).rejects.toThrow('requires a model');

    // With a model, generation delegates to the AI-SDK registry; with no registry injected in
    // this test it fails there — proving the path goes through delegation, not ctx.fetch.
    await expect(
      adapter.generateImage('x', { model: 'dall-e-3', credentials: { apiKey: 'k' } }),
    ).rejects.toThrow(/registry is not available/);

    await expect(adapter.generateVideo('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support video',
    );
    await expect(adapter.generateAudio('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support audio',
    );
    await expect(adapter.generateAvatar('x', { apiKey: 'k' })).rejects.toThrow(
      'does not support avatar',
    );

    // No request ever touched ctx.fetch — image is AI-SDK-delegated, not a native HTTP call.
    expect(recs).toHaveLength(0);
  });
});

describe('azure media adapter testConnection', () => {
  it('GETs {resource}.openai.azure.com/openai/models with the api-key header — 200 ok, 401 Invalid API key, 500 throws, missing fields', async () => {
    const okCtx = makeCtx(() => res({ data: [] }));
    const a1: any = azureMediaModule.create(okCtx.ctx as any);
    expect(await a1.testConnection({ credentials: { apiKey: 'az-key', resourceName: 'my-resource' } }))
      .toEqual({ ok: true, message: 'Connection successful' });
    expect(okCtx.recs[0].url).toBe('https://my-resource.openai.azure.com/openai/models?api-version=2024-10-21');
    expect(okCtx.recs[0].method).toBe('GET');
    expect(okCtx.recs[0].headers['api-key']).toBe('az-key');

    const bad = makeCtx(() => res('unauthorized', false, 401));
    const a2: any = azureMediaModule.create(bad.ctx as any);
    expect(await a2.testConnection({ credentials: { apiKey: 'wrong', resourceName: 'my-resource' } }))
      .toEqual({ ok: false, message: 'Invalid API key' });

    const err = makeCtx(() => res('boom', false, 500));
    const a3: any = azureMediaModule.create(err.ctx as any);
    await expect(a3.testConnection({ credentials: { apiKey: 'az-key', resourceName: 'my-resource' } }))
      .rejects.toThrow(/connection test failed \(500\)/);

    const noKey = makeCtx(() => res({}));
    const a4: any = azureMediaModule.create(noKey.ctx as any);
    expect(await a4.testConnection({ credentials: { resourceName: 'my-resource' } }))
      .toEqual({ ok: false, message: 'Azure OpenAI API key is required' });
    expect(await a4.testConnection({ credentials: { apiKey: 'az-key' } }))
      .toEqual({ ok: false, message: 'Azure OpenAI resource name is required' });
    expect(await a4.testConnection({ credentials: { apiKey: 'az-key', resourceName: 'evil.com/x' } }))
      .toEqual({ ok: false, message: 'Azure OpenAI resource name is invalid' });
    expect(noKey.recs).toHaveLength(0);
  });
});
