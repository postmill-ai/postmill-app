import { describe, it, expect } from 'vitest';
import { makeCtx, res } from '@gitroom/provider-kernel/testing/media-int-helpers';
import { bedrockMediaModule } from './media.adapter';

// Recorded-fixture integration test (plan B4) — no network. AWS Bedrock does NOT build a raw
// HTTP request through ctx.fetch: image generation is delegated to the matching AI Bedrock
// adapter via the AI-SDK media bridge (`generateImageViaAiSdk`), which resolves an injected
// AIProviderRegistry and runs `@ai-sdk/amazon-bedrock` (SigV4 auth). A fetch-recording test
// therefore cannot capture the request body, so we assert only what is honestly verifiable
// without live AWS credentials / registry: manifest + capability metadata, the no-model guard,
// the registry-absent delegation guard, and the unsupported-operation rejections.

describe('bedrock media adapter (AI-SDK delegation)', () => {
  it('exposes image-only capabilities and a correct manifest', () => {
    const { ctx } = makeCtx(() => res({}));
    const adapter: any = bedrockMediaModule.create(ctx as any);
    expect(adapter.identifier).toBe('bedrock');
    expect(adapter.name).toBe('Amazon Bedrock');
    expect(adapter.capabilities.image).toBe(true);
    expect(adapter.capabilities.video).toBe(false);
    expect(adapter.capabilities.audio).toBe(false);
    expect(adapter.capabilities.avatar).toBe(false);

    expect(bedrockMediaModule.manifest.domain).toBe('media');
    expect(bedrockMediaModule.manifest.providerId).toBe('bedrock');
    expect(bedrockMediaModule.manifest.version).toBe('v1');
    expect(bedrockMediaModule.manifest.displayName).toBe('Amazon Bedrock');
    expect(bedrockMediaModule.manifest.status).toBe('active');
  });

  it('guards a missing model, delegates image generation through the AI registry (not ctx.fetch), and rejects unsupported operations', async () => {
    const { recs, ctx } = makeCtx(() => res({}));
    const adapter: any = bedrockMediaModule.create(ctx as any);

    // No model → fails the base-class guard before any delegation.
    await expect(adapter.generateImage('x', { credentials: { region: 'us-east-1' } })).rejects.toThrow(
      'requires a model',
    );

    // With a model, generation delegates to the AI-SDK registry; with no registry injected in
    // this test it fails there — proving the path goes through delegation, not ctx.fetch.
    await expect(
      adapter.generateImage('x', { model: 'amazon.nova-canvas-v1:0', credentials: { region: 'us-east-1' } }),
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
