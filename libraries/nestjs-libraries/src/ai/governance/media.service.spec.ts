import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CapabilityNotAvailable } from './errors';
import { ProviderUpstreamError } from '@postmill-ai/provider-kernel';

const mockImageModelGenerate = vi.fn().mockResolvedValue('https://cdn.example.com/image.png');
const mockImageModel = vi.fn().mockResolvedValue({
  generate: mockImageModelGenerate,
});
const mockGenerateTextWithModel = vi.fn().mockResolvedValue('{"x":0.5,"y":0.5}');

vi.mock('@postmill-ai/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class MockProvider {
    imageModel = mockImageModel;
    generateTextWithModel = mockGenerateTextWithModel;
    resolveConfigForScope = vi.fn().mockResolvedValue({
      providerId: 'openai',
      modelId: 'dall-e-3',
    });
  },
}));

const mockCreateMediaJob = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockCreateSpendLog = vi.fn();

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class MockAiSettings {
    createMediaJob = mockCreateMediaJob;
    createSpendLog = mockCreateSpendLog;
  },
}));

const mockRecordSpend = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class MockBudget {
    recordSpend = mockRecordSpend;
    checkBudget = vi.fn().mockResolvedValue({ allowed: true });
  },
}));

const mockGetSettings = vi.fn().mockResolvedValue(null);

vi.mock('@postmill-ai/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class MockManager {
    getSettings = mockGetSettings;
  },
}));

// ── media-pipeline infra packages (§2.4) ──
const mockCharge = vi.fn().mockResolvedValue(undefined);
vi.mock('@reaatech/media-pipeline-mcp-cost', () => ({
  InMemoryCostLedger: class MockLedger {
    charge = mockCharge;
  },
}));

const mockSign = vi.fn().mockResolvedValue({ signedArtifactId: 'signed-1', manifestUri: 'c2pa:manifest-1' });
vi.mock('@reaatech/media-pipeline-mcp-provenance', () => ({
  ProvenanceSigner: class MockSigner {
    constructor(_config?: unknown) {}
    sign = mockSign;
  },
}));

import { AiMediaService } from './media.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { AiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@postmill-ai/nestjs-libraries/ai/ai-settings.manager';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
} from '@postmill-ai/nestjs-libraries/media/media-provider-adapter.interface';
import { BudgetService } from '@postmill-ai/nestjs-libraries/ai/governance/budget.service';

const NO_CAPS: MediaProviderCapabilities = {
  image: false,
  video: false,
  audio: false,
  avatar: false,
  tts: false,
  stt: false,
  upscale: false,
  bgRemove: false,
  inpaint: false,
  outpaint: false,
};

function makeAdapter(
  identifier: string,
  caps: Partial<MediaProviderCapabilities>,
  overrides: Partial<MediaProviderAdapter> = {},
): MediaProviderAdapter {
  return {
    identifier,
    name: identifier,
    capabilities: { ...NO_CAPS, ...caps },
    generateImage: vi.fn().mockResolvedValue({
      multi: false,
      image: `https://provider.example.com/${identifier}.png`,
      images: [`https://provider.example.com/${identifier}.png`],
      metadata: { provider: identifier, model: 'test-model' },
    }),
    generateVideo: vi.fn().mockResolvedValue({ jobId: `${identifier}-job-1` }),
    generateAudio: vi.fn().mockResolvedValue({ jobId: `${identifier}-audio-1` }),
    generateAvatar: vi.fn().mockResolvedValue({ jobId: `${identifier}-avatar-1` }),
    ...overrides,
  };
}

interface TestSetup {
  resolution: { resolveMedia: (id: string) => MediaProviderAdapter | undefined };
  orgSettings: {
    getEnabledProviders: ReturnType<typeof vi.fn>;
    getConfigForProvider: ReturnType<typeof vi.fn>;
    isProviderEnabledForOperation: ReturnType<typeof vi.fn>;
  };
  lifecycle: {
    createPendingJob: ReturnType<typeof vi.fn>;
    webhookUrlFor: ReturnType<typeof vi.fn>;
    attachProviderJob: ReturnType<typeof vi.fn>;
    completeJob: ReturnType<typeof vi.fn>;
    failJob: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
    storeTranscript: ReturnType<typeof vi.fn>;
  };
}

function setup(
  adapters: MediaProviderAdapter[],
  enabledIdentifiers?: string[],
  defaultsResolution?: { resolve: ReturnType<typeof vi.fn> },
  budget = new (BudgetService as never)(),
  storage?: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> },
): TestSetup & { service: AiMediaService; budget: BudgetService } {
  const map = new Map(adapters.map((a) => [a.identifier, a]));
  const enabled = (enabledIdentifiers ?? adapters.map((a) => a.identifier)).map((identifier) => ({
    identifier,
    storageProviderId: null,
    storageRootFolderId: null,
    extraConfig: {},
  }));

  const resolution = { resolveMedia: (id: string) => map.get(id) };
  const orgSettings = {
    getEnabledProviders: vi.fn().mockResolvedValue(enabled),
    getConfigForProvider: vi.fn().mockImplementation(async (_orgId: string, id: string) => ({
      credentials: { apiKey: `${id}-key` },
      storageProviderId: null,
      storageRootFolderId: null,
    })),
    isProviderEnabledForOperation: vi.fn().mockResolvedValue(true),
  };
  const lifecycle = {
    createPendingJob: vi.fn().mockResolvedValue({ id: 'tracked-job-1' }),
    webhookUrlFor: vi.fn().mockReturnValue('https://backend.example.com/media-jobs/webhook/tracked-job-1/tok'),
    attachProviderJob: vi.fn().mockResolvedValue(undefined),
    completeJob: vi.fn().mockResolvedValue(undefined),
    failJob: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue({ id: 'tracked-job-1', artifactUrl: '/uploads/stored.mp4', status: 'completed' }),
    storeTranscript: vi.fn().mockResolvedValue({ mediaId: 'm-1', path: '/uploads/t.txt', fileSize: 3 }),
  };

  const service = new AiMediaService(
    new (AiSettingsService as never)(),
    new (AIModelProvider as never)(),
    new (AiSettingsManager as never)(),
    resolution as never,
    defaultsResolution as never,
    orgSettings as never,
    lifecycle as never,
    undefined as never,
    undefined as never,
    undefined as never,
    budget,
    storage as never,
  );

  return { service, resolution, orgSettings, lifecycle, budget };
}

function bareService() {
  return new AiMediaService(
    new (AiSettingsService as never)(),
    new (AIModelProvider as never)(),
    new (AiSettingsManager as never)(),
    { resolveMedia: () => undefined } as never,
    undefined,
  );
}

describe('AiMediaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImageModelGenerate.mockResolvedValue('https://cdn.example.com/image.png');
    mockImageModel.mockResolvedValue({ generate: mockImageModelGenerate });
    mockGenerateTextWithModel.mockResolvedValue('{"x":0.5,"y":0.5}');
    mockGetSettings.mockResolvedValue(null);
    mockCreateMediaJob.mockResolvedValue({ id: 'job-1' });
  });

  // ── Image: facade fallback (no media providers — today's behaviour) ──

  describe('generateImage without media providers (facade fallback)', () => {
    it('returns an image URL string from the AI facade', async () => {
      const service = bareService();
      const result = await service.generateImage('a cat wearing a hat');
      expect(result).toBe('https://cdn.example.com/image.png');
      expect(mockImageModel).toHaveBeenCalledWith('utility', undefined);
    });

    it('passes size option through to the facade model', async () => {
      const service = bareService();
      await service.generateImage('a cat', { size: '512x512' });
      expect(mockImageModelGenerate).toHaveBeenCalledWith('a cat', { size: '512x512' });
    });

    it('maps the aspect hint to a gpt-image size on the facade model', async () => {
      const service = bareService();
      await service.generateImage('a cat', { aspect: 'wide' });
      expect(mockImageModelGenerate).toHaveBeenCalledWith('a cat', { size: '1536x1024' });

      await service.generateImage('a cat', { aspect: 'tall' });
      expect(mockImageModelGenerate).toHaveBeenCalledWith('a cat', { size: '1024x1536' });
    });

    it('lets an explicit size win over the aspect hint on the facade model', async () => {
      const service = bareService();
      await service.generateImage('a cat', { size: '512x512', aspect: 'wide' });
      expect(mockImageModelGenerate).toHaveBeenCalledWith('a cat', { size: '512x512' });
    });

    it('records a media job with cost + creditType when orgId is provided', async () => {
      const service = bareService();
      await service.generateImage('a cat', { orgId: 'org-123', userId: 'user-1' });
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-123',
          userId: 'user-1',
          provider: 'openai',
          operation: 'image',
          status: 'done',
          artifactUrl: 'https://cdn.example.com/image.png',
          creditType: undefined,
        }),
      );
      const job = mockCreateMediaJob.mock.calls[0][0];
      expect(typeof job.costUsd).toBe('number');
      expect(job.costUsd).toBeGreaterThan(0);
      expect(mockCharge).toHaveBeenCalled();
    });

    it('does not record a media job when orgId is not provided', async () => {
      const service = bareService();
      await service.generateImage('a cat');
      expect(mockCreateMediaJob).not.toHaveBeenCalled();
    });

    it('records media generation spend in the AI budget ledger when orgId is provided', async () => {
      const budget = new (BudgetService as never)();
      const { service } = setup([], [], undefined, budget);

      await service.generateImage('a cat', { orgId: 'org-123' });

      expect(budget.recordSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'media',
          organizationId: 'org-123',
          provider: 'openai',
          model: 'dall-e-3',
          costUsd: 0.04,
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
    });

    it('signs C2PA provenance when enabled in settings', async () => {
      mockGetSettings.mockResolvedValue({
        ragSettings: {
          provenance: {
            enabled: true,
            signingKey: { source: { kind: 'pem-inline', privateKey: 'k', certificate: 'c' }, algorithm: 'es256' },
          },
        },
      });
      const service = bareService();
      await service.generateImage('a cat', { orgId: 'org-123' });
      expect(mockSign).toHaveBeenCalled();
      expect(mockCreateMediaJob.mock.calls[0][0].provenance).toBe('c2pa:manifest-1');
    });

    it('throws CapabilityNotAvailable when the facade image model is null', async () => {
      mockImageModel.mockResolvedValueOnce(null);
      const service = bareService();
      await expect(service.generateImage('a cat')).rejects.toThrow(CapabilityNotAvailable);
    });

    it('passes through the model error when generate fails', async () => {
      mockImageModelGenerate.mockRejectedValueOnce(new Error('API rate limit exceeded'));
      const service = bareService();
      await expect(service.generateImage('a cat')).rejects.toThrow('API rate limit exceeded');
    });
  });

  // ── Image: capability-driven adapter resolution (§11.2) ──

  describe('generateImage with org media providers', () => {
    it('uses an org-configured image-capable adapter with decrypted credentials', async () => {
      const adapter = makeAdapter('openai', { image: true });
      const { service, orgSettings } = setup([adapter]);

      const result = await service.generateImage('a cat', { orgId: 'org-1' });

      expect(result).toBe('https://provider.example.com/openai.png');
      expect(orgSettings.getConfigForProvider).toHaveBeenCalledWith('org-1', 'openai');
      expect(adapter.generateImage).toHaveBeenCalledWith('a cat', {
        credentials: { apiKey: 'openai-key' },
        size: undefined,
      });
      expect(mockImageModel).not.toHaveBeenCalled();
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', operation: 'image' }),
      );
    });

    it('strips settings keys outside the image bucket before spreading into the adapter input', async () => {
      // A stale org default row carrying an audio-only key ('response_format')
      // must not reach the image adapter — it 400s on image APIs. Image-bucket
      // keys pass through untouched; the stored row is not rewritten.
      const adapter = makeAdapter('openai', { image: true });
      const defaultsResolution = {
        resolve: vi.fn().mockResolvedValue({
          providerId: 'openai',
          version: 'v1',
          model: 'gpt-image-1',
          settings: { quality: 'high', response_format: 'mp3' },
        }),
      };
      const { service } = setup([adapter], [], defaultsResolution);

      await service.generateImage('a cat', { orgId: 'org-1' });

      expect(adapter.generateImage).toHaveBeenCalledWith(
        'a cat',
        expect.objectContaining({
          model: 'gpt-image-1',
          input: { quality: 'high' },
        }),
      );
    });

    it('forwards the aspect hint to the adapter (per-provider size mapping lives there)', async () => {
      const adapter = makeAdapter('openai', { image: true });
      const { service } = setup([adapter]);

      await service.generateImage('a cat', { orgId: 'org-1', aspect: 'tall' });

      expect(adapter.generateImage).toHaveBeenCalledWith(
        'a cat',
        expect.objectContaining({ aspect: 'tall' }),
      );
    });

    it('returns the standardized result shape from generateImageResult', async () => {
      const adapter = makeAdapter('fal', { image: true }, {
        generateImage: vi.fn().mockResolvedValue({
          multi: true,
          image: 'https://x/1.png',
          images: ['https://x/1.png', 'https://x/2.png'],
        }),
      });
      const { service } = setup([adapter]);

      const result = await service.generateImageResult('two cats', { orgId: 'org-1' });
      expect(result).toEqual({
        multi: true,
        image: 'https://x/1.png',
        images: ['https://x/1.png', 'https://x/2.png'],
        metadata: undefined,
      });
    });

    it('resolves adapters deterministically (alphabetical) and falls through on failure', async () => {
      const failing = makeAdapter('fal', { image: true }, {
        generateImage: vi.fn().mockRejectedValue(new Error('fal down')),
      });
      const working = makeAdapter('openai', { image: true });
      const { service } = setup([working, failing]);

      const result = await service.generateImage('a cat', { orgId: 'org-1' });

      // 'fal' sorts before 'openai' and is tried first.
      expect(failing.generateImage).toHaveBeenCalled();
      expect(result).toBe('https://provider.example.com/openai.png');
    });

    it('skips adapters that do not declare the image capability', async () => {
      const videoOnly = makeAdapter('luma', { video: true });
      const { service } = setup([videoOnly]);

      const result = await service.generateImage('a cat', { orgId: 'org-1' });

      expect(videoOnly.generateImage).not.toHaveBeenCalled();
      expect(result).toBe('https://cdn.example.com/image.png'); // facade fallback
    });

    it('honours extraConfig.operations gating', async () => {
      const adapter = makeAdapter('replicate', { image: true, upscale: true });
      const { service, orgSettings } = setup([adapter]);
      orgSettings.getEnabledProviders.mockResolvedValue([
        {
          identifier: 'replicate',
          storageProviderId: null,
          storageRootFolderId: null,
          extraConfig: { operations: ['upscale'] },
        },
      ]);

      const result = await service.generateImage('a cat', { orgId: 'org-1' });
      expect(adapter.generateImage).not.toHaveBeenCalled();
      expect(result).toBe('https://cdn.example.com/image.png');
    });

    it('skips providers whose credentials are empty', async () => {
      const adapter = makeAdapter('openai', { image: true });
      const { service, orgSettings } = setup([adapter]);
      orgSettings.getConfigForProvider.mockResolvedValue({
        credentials: {},
        storageProviderId: null,
        storageRootFolderId: null,
      });

      const result = await service.generateImage('a cat', { orgId: 'org-1' });
      expect(adapter.generateImage).not.toHaveBeenCalled();
      expect(result).toBe('https://cdn.example.com/image.png');
    });
  });

  // ── Async generation (§11.2) ──

  describe('generateVideo', () => {
    it('throws CapabilityNotAvailable when no video provider is configured', async () => {
      const service = bareService();
      await expect(service.generateVideo('a sunset')).rejects.toThrow(CapabilityNotAvailable);
      expect(mockImageModel).not.toHaveBeenCalled();
    });

    it('creates a tracked AIMediaJob, passes the webhook URL, and returns the job id', async () => {
      const adapter = makeAdapter('luma', { video: true });
      const { service, lifecycle } = setup([adapter]);

      const result = await service.generateVideo('a sunset', { orgId: 'org-1', userId: 'u-1' });

      expect(lifecycle.createPendingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'u-1',
          provider: 'luma',
          operation: 'video',
          creditType: undefined,
        }),
      );
      expect(adapter.generateVideo).toHaveBeenCalledWith('a sunset', expect.objectContaining({
        credentials: { apiKey: 'luma-key' },
        webhookUrl: 'https://backend.example.com/media-jobs/webhook/tracked-job-1/tok',
      }));
      expect(lifecycle.attachProviderJob).toHaveBeenCalledWith('tracked-job-1', 'luma-job-1', 'org-1');
      expect(result).toBe('tracked-job-1');
    });

    it('completes inline submissions immediately and returns the stored artifact URL', async () => {
      const adapter = makeAdapter('stability-ai', { video: true }, {
        generateVideo: vi.fn().mockResolvedValue({
          jobId: 'inline-1',
          artifactUrl: 'data:video/mp4;base64,AAA',
          metadata: { mime: 'video/mp4' },
        }),
      });
      const { service, lifecycle } = setup([adapter]);

      const result = await service.generateVideo('a sunset', { orgId: 'org-1' });

      expect(lifecycle.completeJob).toHaveBeenCalledWith(
        { id: 'tracked-job-1' },
        'data:video/mp4;base64,AAA',
        { mime: 'video/mp4' },
      );
      expect(result).toBe('/uploads/stored.mp4');
    });

    it('marks the job failed (without notifying) and tries the next provider', async () => {
      const failing = makeAdapter('heygen', { video: true }, {
        generateVideo: vi.fn().mockRejectedValue(new Error('heygen down')),
      });
      const working = makeAdapter('luma', { video: true });
      const { service, lifecycle } = setup([failing, working]);

      const result = await service.generateVideo('a sunset', { orgId: 'org-1' });

      expect(lifecycle.failJob).toHaveBeenCalledWith(
        { id: 'tracked-job-1' },
        'heygen down',
        { notify: false },
      );
      expect(result).toBe('tracked-job-1');
      expect(working.generateVideo).toHaveBeenCalled();
    });

    it('throws when every provider fails', async () => {
      const failing = makeAdapter('luma', { video: true }, {
        generateVideo: vi.fn().mockRejectedValue(new Error('down')),
      });
      const { service } = setup([failing]);

      await expect(service.generateVideo('a sunset', { orgId: 'org-1' })).rejects.toThrow('down');
    });

    it('throws CapabilityNotAvailable when there is no org context', async () => {
      const adapter = makeAdapter('luma', { video: true });
      const { service, lifecycle, orgSettings } = setup([adapter]);
      // _resolveForOperation requires an orgId — without one there are no candidates.
      await expect(service.generateVideo('a sunset')).rejects.toThrow(CapabilityNotAvailable);
      expect(orgSettings.getEnabledProviders).not.toHaveBeenCalled();
      expect(lifecycle.createPendingJob).not.toHaveBeenCalled();
      expect(mockImageModel).not.toHaveBeenCalled();
    });
  });

  describe('generateAudio / generateAvatar', () => {
    it('throws CapabilityNotAvailable when no audio provider is configured', async () => {
      const service = bareService();
      await expect(service.generateAudio('a jingle', { orgId: 'org-1' })).rejects.toThrow(CapabilityNotAvailable);
    });

    it('tracks an avatar job via the lifecycle', async () => {
      const adapter = makeAdapter('heygen', { avatar: true });
      const { service, lifecycle } = setup([adapter]);

      const result = await service.generateAvatar('hello world', { orgId: 'org-1' });

      expect(lifecycle.createPendingJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'heygen', operation: 'avatar', creditType: undefined }),
      );
      expect(adapter.generateAvatar).toHaveBeenCalled();
      expect(result).toBe('tracked-job-1');
    });

    it('tracks an audio job via the lifecycle', async () => {
      const adapter = makeAdapter('fal', { audio: true });
      const { service, lifecycle } = setup([adapter]);

      const result = await service.generateAudio('a jingle', { orgId: 'org-1' });

      expect(lifecycle.createPendingJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'fal', operation: 'audio' }),
      );
      expect(result).toBe('tracked-job-1');
    });
  });

  // ── Speech ──

  describe('textToSpeech', () => {
    it('throws CapabilityNotAvailable when no TTS provider configured', async () => {
      const service = bareService();
      await expect(service.textToSpeech('hello world')).rejects.toThrow(CapabilityNotAvailable);
      await expect(service.textToSpeech('hello world')).rejects.toThrow('Text-to-speech is not available');
    });

    it('uses a TTS-capable adapter and returns a Buffer', async () => {
      const adapter = makeAdapter('elevenlabs', { tts: true }, {
        textToSpeech: vi.fn().mockResolvedValue(Buffer.from('audio-bytes')),
      });
      const { service } = setup([adapter]);

      const result = await service.textToSpeech('hello', { orgId: 'org-1', voice: 'adam' });

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('audio-bytes');
      expect(adapter.textToSpeech).toHaveBeenCalledWith('hello', {
        credentials: { apiKey: 'elevenlabs-key' },
        voice: 'adam',
      });
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'elevenlabs', operation: 'tts' }),
      );
    });

    it('decodes base64 string results', async () => {
      const adapter = makeAdapter('openai', { tts: true }, {
        textToSpeech: vi.fn().mockResolvedValue(Buffer.from('raw').toString('base64')),
      });
      const { service } = setup([adapter]);

      const result = await service.textToSpeech('hello', { orgId: 'org-1' });
      expect(result.toString()).toBe('raw');
    });

    it('rethrows the provider error when a resolved candidate fails (no bogus "not available" 409)', async () => {
      // Prod case (Postmill QA, generate-slide): the org's default OpenAI TTS
      // provider resolved fine but the upstream call hit the safeFetch timeout —
      // the caller must see the real error, not CapabilityNotAvailable claiming
      // no TTS provider is configured (mirrors _startAsyncJob's lastError rethrow).
      const adapter = makeAdapter('openai', { tts: true }, {
        textToSpeech: vi.fn().mockRejectedValue(new Error('safeFetch request timed out after 30000ms')),
      });
      const { service } = setup([adapter]);

      await expect(service.textToSpeech('hello', { orgId: 'org-1' })).rejects.toThrow(
        'safeFetch request timed out after 30000ms',
      );
      await expect(service.textToSpeech('hello', { orgId: 'org-1' })).rejects.not.toThrow(
        CapabilityNotAvailable,
      );
    });
  });

  describe('textToSpeech provider pin', () => {
    const ttsAdapter = (id: string, result: unknown = Buffer.from(`${id}-audio`)) =>
      makeAdapter(id, { tts: true }, {
        textToSpeech: vi.fn().mockResolvedValue(result),
      });

    it('attempts only the pinned provider', async () => {
      const elevenlabs = ttsAdapter('elevenlabs');
      const openai = ttsAdapter('openai');
      const { service, orgSettings } = setup([elevenlabs, openai]);

      const result = await service.textToSpeech('hello', { orgId: 'org-1', provider: 'openai' });

      expect(result.toString()).toBe('openai-audio');
      expect(openai.textToSpeech).toHaveBeenCalledTimes(1);
      expect(elevenlabs.textToSpeech).not.toHaveBeenCalled();
      expect(orgSettings.isProviderEnabledForOperation).toHaveBeenCalledWith('org-1', 'openai', 'tts');
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', operation: 'tts' }),
      );
    });

    it('rejects an unknown provider with a 400', async () => {
      const { service } = setup([]);
      await expect(
        service.textToSpeech('hello', { orgId: 'org-1', provider: 'nope' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.textToSpeech('hello', { orgId: 'org-1', provider: 'nope' }),
      ).rejects.toThrow('Unknown media provider "nope"');
    });

    it('rejects a provider without the tts capability with a 400', async () => {
      const imageOnly = makeAdapter('replicate', { image: true });
      const { service } = setup([imageOnly]);
      await expect(
        service.textToSpeech('hello', { orgId: 'org-1', provider: 'replicate' }),
      ).rejects.toThrow('does not support tts');
    });

    it('rejects a provider disabled for the org with a 400', async () => {
      const elevenlabs = ttsAdapter('elevenlabs');
      const { service, orgSettings } = setup([elevenlabs]);
      orgSettings.isProviderEnabledForOperation.mockResolvedValue(false);

      await expect(
        service.textToSpeech('hello', { orgId: 'org-1', provider: 'elevenlabs' }),
      ).rejects.toThrow('not enabled for this organization');
      expect(elevenlabs.textToSpeech).not.toHaveBeenCalled();
    });

    it('rejects an enabled provider with no credentials with a 400', async () => {
      const elevenlabs = ttsAdapter('elevenlabs');
      const { service, orgSettings } = setup([elevenlabs]);
      orgSettings.getConfigForProvider.mockResolvedValue(null);

      await expect(
        service.textToSpeech('hello', { orgId: 'org-1', provider: 'elevenlabs' }),
      ).rejects.toThrow('not configured for this organization');
      expect(elevenlabs.textToSpeech).not.toHaveBeenCalled();
    });

    it('propagates a pinned failure without falling back to another provider', async () => {
      const elevenlabs = makeAdapter('elevenlabs', { tts: true }, {
        textToSpeech: vi.fn().mockRejectedValue(new Error('elevenlabs down')),
      });
      const openai = ttsAdapter('openai');
      const { service } = setup([elevenlabs, openai]);

      await expect(
        service.textToSpeech('hello', { orgId: 'org-1', provider: 'elevenlabs' }),
      ).rejects.toThrow('elevenlabs down');
      expect(openai.textToSpeech).not.toHaveBeenCalled();
    });

    it('still falls back across candidates when no provider is pinned', async () => {
      const elevenlabs = makeAdapter('elevenlabs', { tts: true }, {
        textToSpeech: vi.fn().mockRejectedValue(new Error('elevenlabs down')),
      });
      const openai = ttsAdapter('openai');
      const { service } = setup([elevenlabs, openai]);

      const result = await service.textToSpeech('hello', { orgId: 'org-1' });

      expect(result.toString()).toBe('openai-audio');
      expect(elevenlabs.textToSpeech).toHaveBeenCalled();
      expect(openai.textToSpeech).toHaveBeenCalled();
    });
  });

  describe('speechToText', () => {
    it('throws CapabilityNotAvailable when no STT provider configured', async () => {
      const service = bareService();
      await expect(service.speechToText(Buffer.from('audio'))).rejects.toThrow(CapabilityNotAvailable);
    });

    it('transcribes via an STT-capable adapter and stores the transcript document (§11.1)', async () => {
      const adapter = makeAdapter('deepgram', { stt: true }, {
        speechToText: vi.fn().mockResolvedValue('the transcript'),
      });
      const { service, lifecycle } = setup([adapter]);

      const result = await service.speechToText(Buffer.from('audio'), { orgId: 'org-1' });

      expect(result).toBe('the transcript');
      expect(lifecycle.storeTranscript).toHaveBeenCalledWith({
        organizationId: 'org-1',
        provider: 'deepgram',
        text: 'the transcript',
      });
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'deepgram', operation: 'stt' }),
      );
    });

    it('still returns the transcript when storing the document fails', async () => {
      const adapter = makeAdapter('deepgram', { stt: true }, {
        speechToText: vi.fn().mockResolvedValue('text'),
      });
      const { service, lifecycle } = setup([adapter]);
      lifecycle.storeTranscript.mockRejectedValue(new Error('storage down'));

      const result = await service.speechToText(Buffer.from('audio'), { orgId: 'org-1' });
      expect(result).toBe('text');
    });
  });

  // ── Image edits ──

  describe('upscaleImage', () => {
    it('returns the original image URL when no upscale provider configured', async () => {
      const service = bareService();
      const url = 'https://cdn.example.com/low-res.png';
      expect(await service.upscaleImage(url)).toBe(url);
      expect(await service.upscaleImage(url, { orgId: 'org-1' })).toBe(url);
    });

    it('uses an upscale-capable adapter', async () => {
      const adapter = makeAdapter('replicate', { upscale: true }, {
        upscaleImage: vi.fn().mockResolvedValue('https://x/upscaled.png'),
      });
      const { service } = setup([adapter]);

      const result = await service.upscaleImage('https://x/low.png', { orgId: 'org-1' });
      expect(result).toBe('https://x/upscaled.png');
    });

    it('returns the original when the adapter fails', async () => {
      const adapter = makeAdapter('replicate', { upscale: true }, {
        upscaleImage: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const { service } = setup([adapter]);

      const url = 'https://x/low.png';
      expect(await service.upscaleImage(url, { orgId: 'org-1' })).toBe(url);
    });
  });

  describe('removeBackground', () => {
    it('throws CapabilityNotAvailable when no provider configured', async () => {
      const service = bareService();
      await expect(service.removeBackground('https://x/img.png')).rejects.toThrow(CapabilityNotAvailable);
      await expect(service.removeBackground('https://x/img.png', { orgId: 'org-1' })).rejects.toThrow(
        'Background removal is not available',
      );
    });

    it('uses a bgRemove-capable adapter', async () => {
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockResolvedValue('https://x/nobg.png'),
      });
      const { service } = setup([adapter]);

      const result = await service.removeBackground('https://x/img.png', { orgId: 'org-1' });
      expect(result).toBe('https://x/nobg.png');
    });

    it('propagates the typed upstream error when a configured provider fails (→ 502, not 409)', async () => {
      const upstream = new ProviderUpstreamError(
        { domain: 'media', providerId: 'replicate', providerName: 'Replicate', operation: 'bg-remove' },
        'invalid_request',
        'The requested resource could not be found',
        404,
      );
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockRejectedValue(upstream),
      });
      const { service } = setup([adapter]);

      await expect(service.removeBackground('https://x/img.png', { orgId: 'org-1' })).rejects.toBe(upstream);
    });

    it('propagates a plain adapter failure too (configured-but-failed is never 409)', async () => {
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const { service } = setup([adapter]);

      await expect(service.removeBackground('https://x/img.png', { orgId: 'org-1' })).rejects.toThrow('boom');
      await expect(service.removeBackground('https://x/img.png', { orgId: 'org-1' })).rejects.not.toThrow(
        CapabilityNotAvailable,
      );
    });
  });

  describe('image-edit inputs arriving as data URIs (persist hop)', () => {
    const tinyPngDataUri = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`;
    const mintedUrl = 'https://uploads.example.com/uploads/org-1/2026/10/21/abc.png';
    const storageWith = (writeBuffer: ReturnType<typeof vi.fn>) => ({
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({ writeBuffer }),
    });

    it('persists a data-URI input and hands the provider the minted upload URL', async () => {
      const writeBuffer = vi.fn().mockResolvedValue(mintedUrl);
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockResolvedValue('https://x/nobg.png'),
      });
      const { service } = setup([adapter], undefined, undefined, undefined, storageWith(writeBuffer));

      const result = await service.removeBackground(tinyPngDataUri, { orgId: 'org-1' });
      expect(result).toBe('https://x/nobg.png');
      expect(writeBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'image/png');
      expect(adapter.removeBackground).toHaveBeenCalledWith(mintedUrl, expect.anything());
    });

    it('persists both image and mask for inpaint', async () => {
      const writeBuffer = vi.fn()
        .mockResolvedValueOnce('https://uploads.example.com/uploads/org-1/img.png')
        .mockResolvedValueOnce('https://uploads.example.com/uploads/org-1/mask.png');
      const adapter = makeAdapter('replicate', { inpaint: true }, {
        inpaintImage: vi.fn().mockResolvedValue('https://x/inpainted.png'),
      });
      const { service } = setup([adapter], undefined, undefined, undefined, storageWith(writeBuffer));

      await service.inpaintImage(tinyPngDataUri, tinyPngDataUri, 'fill sky', { orgId: 'org-1' });
      expect(writeBuffer).toHaveBeenCalledTimes(2);
      expect(adapter.inpaintImage).toHaveBeenCalledWith(
        'https://uploads.example.com/uploads/org-1/img.png',
        'https://uploads.example.com/uploads/org-1/mask.png',
        'fill sky',
        expect.anything(),
      );
    });

    it('persists a data-URI sourceUrl for image-to-image generation', async () => {
      const writeBuffer = vi.fn().mockResolvedValue(mintedUrl);
      const adapter = makeAdapter('replicate', { image: true });
      const { service } = setup([adapter], undefined, undefined, undefined, storageWith(writeBuffer));

      await service.generateImage('make it pop', { orgId: 'org-1', sourceUrl: tinyPngDataUri });
      expect(writeBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'image/png');
      expect(adapter.generateImage).toHaveBeenCalledWith(
        'make it pop',
        expect.objectContaining({ sourceUrl: mintedUrl }),
      );
    });

    it('falls back to passing the data URI through when persistence fails', async () => {
      const storage = { getLocalAdapterForOrg: vi.fn().mockRejectedValue(new Error('no storage')) };
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockResolvedValue('https://x/nobg.png'),
      });
      const { service } = setup([adapter], undefined, undefined, undefined, storage);

      const result = await service.removeBackground(tinyPngDataUri, { orgId: 'org-1' });
      expect(result).toBe('https://x/nobg.png');
      expect(adapter.removeBackground).toHaveBeenCalledWith(tinyPngDataUri, expect.anything());
    });

    it('never attempts persistence without an orgId (no org scope, no candidates)', async () => {
      const writeBuffer = vi.fn().mockResolvedValue(mintedUrl);
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockResolvedValue('https://x/nobg.png'),
      });
      const { service } = setup([adapter], undefined, undefined, undefined, storageWith(writeBuffer));

      await expect(service.removeBackground(tinyPngDataUri)).rejects.toThrow(CapabilityNotAvailable);
      expect(writeBuffer).not.toHaveBeenCalled();
    });
  });

  describe('inpaintImage', () => {
    it('throws CapabilityNotAvailable when no provider configured', async () => {
      const service = bareService();
      await expect(service.inpaintImage('img.png', 'mask.png', 'fill')).rejects.toThrow(CapabilityNotAvailable);
    });

    it('uses an inpaint-capable adapter', async () => {
      const adapter = makeAdapter('replicate', { inpaint: true }, {
        inpaintImage: vi.fn().mockResolvedValue('https://x/inpainted.png'),
      });
      const { service } = setup([adapter]);

      const result = await service.inpaintImage('img.png', 'mask.png', 'fill sky', { orgId: 'org-1' });
      expect(result).toBe('https://x/inpainted.png');
      expect(adapter.inpaintImage).toHaveBeenCalledWith('img.png', 'mask.png', 'fill sky', {
        credentials: { apiKey: 'replicate-key' },
      });
    });

    it('propagates the typed upstream error when a configured provider fails (→ 502, not 409)', async () => {
      const upstream = new ProviderUpstreamError(
        { domain: 'media', providerId: 'replicate', providerName: 'Replicate', operation: 'inpaint' },
        'unavailable',
        'upstream 503',
        503,
      );
      const adapter = makeAdapter('replicate', { inpaint: true }, {
        inpaintImage: vi.fn().mockRejectedValue(upstream),
      });
      const { service } = setup([adapter]);

      await expect(service.inpaintImage('img.png', 'mask.png', 'fill', { orgId: 'org-1' })).rejects.toBe(upstream);
    });
  });

  describe('outpaintImage', () => {
    it('throws CapabilityNotAvailable when no provider configured', async () => {
      const service = bareService();
      await expect(service.outpaintImage('img.png', 'zoom-2x')).rejects.toThrow(CapabilityNotAvailable);
      await expect(service.outpaintImage('img.png', 'zoom-2x', undefined, { orgId: 'org-1' })).rejects.toThrow(
        'Image expansion is not available',
      );
    });

    it('uses an outpaint-capable adapter and forwards mode/prompt', async () => {
      const adapter = makeAdapter('replicate', { outpaint: true }, {
        outpaintImage: vi.fn().mockResolvedValue('https://x/expanded.png'),
      });
      const { service } = setup([adapter]);

      const result = await service.outpaintImage('img.png', 'left', 'more ocean', { orgId: 'org-1' });
      expect(result).toBe('https://x/expanded.png');
      expect(adapter.outpaintImage).toHaveBeenCalledWith('img.png', 'left', 'more ocean', {
        credentials: { apiKey: 'replicate-key' },
      });
    });

    it('propagates the typed upstream error when a configured provider fails (→ 502, not 409)', async () => {
      const upstream = new ProviderUpstreamError(
        { domain: 'media', providerId: 'replicate', providerName: 'Replicate', operation: 'outpaint' },
        'unavailable',
        'upstream 503',
        503,
      );
      const adapter = makeAdapter('replicate', { outpaint: true }, {
        outpaintImage: vi.fn().mockRejectedValue(upstream),
      });
      const { service } = setup([adapter]);

      await expect(service.outpaintImage('img.png', 'make-square', undefined, { orgId: 'org-1' })).rejects.toBe(upstream);
    });

    it('propagates a plain adapter failure too (configured-but-failed is never 409)', async () => {
      const adapter = makeAdapter('replicate', { outpaint: true }, {
        outpaintImage: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const { service } = setup([adapter]);

      await expect(service.outpaintImage('img.png', 'top', undefined, { orgId: 'org-1' })).rejects.toThrow('boom');
      await expect(service.outpaintImage('img.png', 'top', undefined, { orgId: 'org-1' })).rejects.not.toThrow(
        CapabilityNotAvailable,
      );
    });

    it('skips providers that resolved for the operation but lack outpaintImage', async () => {
      const capable = makeAdapter('replicate', { outpaint: true }, {
        outpaintImage: vi.fn().mockResolvedValue('https://x/expanded.png'),
      });
      // Capability flag on, method missing — defensive guard parity with inpaint.
      const noMethod = makeAdapter('other', { outpaint: true });
      const { service } = setup([noMethod, capable]);

      const result = await service.outpaintImage('img.png', 'zoom-1.5x', undefined, { orgId: 'org-1' });
      expect(result).toBe('https://x/expanded.png');
    });
  });

  // ── Audio (music) candidate filtering ──

  describe('generateAudio TTS exclusion', () => {
    it('never routes a music prompt to a TTS-only adapter (audio:true + tts:true)', async () => {
      // openai sorts before replicate in the candidate list — without the
      // exclusion it would swallow the music prompt as speech.
      const ttsOnly = makeAdapter('openai', { audio: true, tts: true });
      const music = makeAdapter('replicate', { audio: true, tts: false });
      const { service } = setup([ttsOnly, music]);

      await service.generateAudio('epic orchestral score', { orgId: 'org-1' });

      expect(ttsOnly.generateAudio).not.toHaveBeenCalled();
      expect(music.generateAudio).toHaveBeenCalled();
    });

    it('is CapabilityNotAvailable when every audio provider is TTS-only', async () => {
      const ttsOnly = makeAdapter('elevenlabs', { audio: true, tts: true });
      const { service } = setup([ttsOnly]);

      await expect(service.generateAudio('a jingle', { orgId: 'org-1' })).rejects.toThrow(
        CapabilityNotAvailable,
      );
      expect(ttsOnly.generateAudio).not.toHaveBeenCalled();
    });
  });

  // ── Tool status: slideshow gating ──

  describe('getToolStatus image-slide gating', () => {
    const slideDefaults = (overrides: Record<string, unknown> = {}) => ({
      resolve: vi.fn().mockImplementation(async (domain: string, category: string) => {
        const key = `${domain}/${category}`;
        if (key in overrides) return overrides[key];
        return null;
      }),
    });
    const slideDefault = {
      providerId: 'replicate',
      version: 'v1',
      model: 'black-forest-labs/flux-1.1-pro',
      source: 'org',
    };
    const reasoningDefault = { providerId: 'openai', version: 'v1', model: 'gpt-4.1', source: 'auto' };
    // The TTS leg of the slideshow gate follows the tts OPERATION availability
    // (the same capability-driven resolution as POST /media/text-to-speech), so
    // the fixture needs a TTS-capable adapter, not a 'media/text-to-speech'
    // defaults-catalog row.
    const ttsAdapter = () =>
      makeAdapter('openai', { tts: true }, {
        textToSpeech: vi.fn().mockResolvedValue(Buffer.from('audio')),
      });

    it('marks image-slide available when frames, TTS and reasoning all resolve', async () => {
      const adapter = makeAdapter('replicate', { image: true });
      const defaultsResolution = slideDefaults({
        'media/image-slide': slideDefault,
        'ai/high-reasoning': reasoningDefault,
      });
      const { service } = setup([adapter, ttsAdapter()], undefined, defaultsResolution);

      const status = await service.getToolStatus('org-1');

      expect(status.tools['image-slide'].available).toBe(true);
    });

    it('marks image-slide unavailable and names the missing text-to-speech provider', async () => {
      const adapter = makeAdapter('replicate', { image: true });
      const defaultsResolution = slideDefaults({
        'media/image-slide': slideDefault,
        'ai/high-reasoning': reasoningDefault,
      });
      // No TTS-capable adapter enabled → the tts operation is unavailable even
      // though the image and reasoning defaults resolve.
      const { service } = setup([adapter], undefined, defaultsResolution);

      const status = await service.getToolStatus('org-1');

      expect(status.tools['image-slide'].available).toBe(false);
      expect(status.tools['image-slide'].reason).toContain('text-to-speech');
    });

    it('marks image-slide unavailable and names the missing high-reasoning default', async () => {
      const adapter = makeAdapter('replicate', { image: true });
      const defaultsResolution = slideDefaults({
        'media/image-slide': slideDefault,
      });
      const { service } = setup([adapter, ttsAdapter()], undefined, defaultsResolution);

      const status = await service.getToolStatus('org-1');

      expect(status.tools['image-slide'].available).toBe(false);
      expect(status.tools['image-slide'].reason).toContain('high-reasoning');
    });
  });

  // ── Image edits: provider-reachable URLs ──

  describe('image-edit URL resolution', () => {
    let uploadDir: string;
    let previousUploadDirectory: string | undefined;
    let previousFrontendUrl: string | undefined;

    beforeEach(() => {
      previousUploadDirectory = process.env.UPLOAD_DIRECTORY;
      previousFrontendUrl = process.env.FRONTEND_URL;
      uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-uploads-'));
      process.env.UPLOAD_DIRECTORY = uploadDir;
      process.env.FRONTEND_URL = 'http://localhost:4200';
      // A 1x1 PNG so the type sniffer has something real to read.
      fs.writeFileSync(
        path.join(uploadDir, 'photo.png'),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      );
    });

    afterEach(() => {
      if (previousUploadDirectory === undefined) delete process.env.UPLOAD_DIRECTORY;
      else process.env.UPLOAD_DIRECTORY = previousUploadDirectory;
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
    });

    it('inlines a local upload as a data URI before calling the bg-remove provider', async () => {
      // Replicate downloads the image from ITS infrastructure — a
      // localhost/uploads URL is unreachable and failed 100% of the time.
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockResolvedValue('https://x/nobg.png'),
      });
      const { service } = setup([adapter]);

      await service.removeBackground('http://localhost:4200/uploads/photo.png', { orgId: 'org-1' });

      const passed = (adapter.removeBackground as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(passed.startsWith('data:image/png;base64,')).toBe(true);
      expect(passed).not.toContain('localhost');
    });

    it('inlines local image AND mask for inpaint', async () => {
      const adapter = makeAdapter('replicate', { inpaint: true }, {
        inpaintImage: vi.fn().mockResolvedValue('https://x/inpainted.png'),
      });
      const { service } = setup([adapter]);

      await service.inpaintImage(
        'http://localhost:4200/uploads/photo.png',
        'http://localhost:4200/uploads/photo.png',
        'fill sky',
        { orgId: 'org-1' },
      );

      const calls = (adapter.inpaintImage as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(calls[0].startsWith('data:image/png;base64,')).toBe(true);
      expect(calls[1].startsWith('data:image/png;base64,')).toBe(true);
    });

    it('passes a remote URL through unchanged', async () => {
      const adapter = makeAdapter('replicate', { outpaint: true }, {
        outpaintImage: vi.fn().mockResolvedValue('https://x/expanded.png'),
      });
      const { service } = setup([adapter]);

      await service.outpaintImage('https://cdn.example.com/photo.png', 'zoom-2x', undefined, { orgId: 'org-1' });

      expect((adapter.outpaintImage as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        'https://cdn.example.com/photo.png',
      );
    });

    it('rejects a local upload it cannot read instead of handing the provider a dead URL', async () => {
      const adapter = makeAdapter('replicate', { bgRemove: true }, {
        removeBackground: vi.fn().mockResolvedValue('https://x/nobg.png'),
      });
      const { service } = setup([adapter]);

      await expect(
        service.removeBackground('http://localhost:4200/uploads/missing.png', { orgId: 'org-1' }),
      ).rejects.toThrow('could not be read');
      expect(adapter.removeBackground).not.toHaveBeenCalled();
    });
  });

  // ── Focal point ──

  describe('detectFocalPoint', () => {
    it('returns clamped coordinates from the vision default model', async () => {
      mockGenerateTextWithModel.mockResolvedValueOnce('{"x":1.5,"y":-0.2}');
      const defaultsResolution = {
        resolve: vi.fn().mockResolvedValue({
          providerId: 'openai',
          version: 'v1',
          model: 'gpt-4o',
          source: 'auto',
        }),
      };
      const { service } = setup([], [], defaultsResolution);

      const result = await service.detectFocalPoint('https://cdn.example.com/photo.jpg', { orgId: 'org-1' });

      expect(result).toEqual({ x: 1, y: 0, source: 'provider' });
      expect(defaultsResolution.resolve).toHaveBeenCalledWith('ai', 'vision', 'org-1');
      expect(mockGenerateTextWithModel).toHaveBeenCalledWith(
        'org-1',
        'openai',
        'v1',
        'gpt-4o',
        expect.objectContaining({ imageUrl: 'https://cdn.example.com/photo.jpg' }),
      );
    });

    it('falls back to center when no vision default is configured', async () => {
      const defaultsResolution = { resolve: vi.fn().mockResolvedValue(null) };
      const { service } = setup([], [], defaultsResolution);

      const result = await service.detectFocalPoint('https://cdn.example.com/photo.jpg', { orgId: 'org-1' });

      expect(result).toEqual({ x: 0.5, y: 0.5, source: 'fallback' });
      expect(mockGenerateTextWithModel).not.toHaveBeenCalled();
    });

    // Round 8 C1: the vision provider downloads the image from ITS OWN
    // infrastructure, so a URL on this instance's storage host is unreachable —
    // every lookup failed with "Error while downloading
    // http://localhost:4200/uploads/…". The vision critic already inlined those
    // as data URIs; the detector did not, and now shares the helper.
    describe('local upload resolution', () => {
      let uploadDir: string;
      let previousUploadDirectory: string | undefined;
      let previousFrontendUrl: string | undefined;

      const visionDefaults = () => ({
        resolve: vi.fn().mockResolvedValue({
          providerId: 'openai',
          version: 'v1',
          model: 'gpt-4o',
          source: 'auto',
        }),
      });

      beforeEach(() => {
        previousUploadDirectory = process.env.UPLOAD_DIRECTORY;
        previousFrontendUrl = process.env.FRONTEND_URL;
        uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focal-uploads-'));
        process.env.UPLOAD_DIRECTORY = uploadDir;
        process.env.FRONTEND_URL = 'http://localhost:4200';
      });

      const restoreEnv = () => {
        if (previousUploadDirectory === undefined) delete process.env.UPLOAD_DIRECTORY;
        else process.env.UPLOAD_DIRECTORY = previousUploadDirectory;
        if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = previousFrontendUrl;
      };

      it('inlines a local upload as a data URI instead of a localhost URL', async () => {
        // A 1x1 PNG so the type sniffer has something real to read.
        fs.writeFileSync(
          path.join(uploadDir, 'photo.png'),
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
        mockGenerateTextWithModel.mockResolvedValueOnce('{"x":0.3,"y":0.7}');
        const { service } = setup([], [], visionDefaults());

        const result = await service.detectFocalPoint(
          'http://localhost:4200/uploads/photo.png',
          { orgId: 'org-1' },
        );

        expect(result).toEqual({ x: 0.3, y: 0.7, source: 'provider' });
        const passed = mockGenerateTextWithModel.mock.calls.at(-1)![4].imageUrl;
        expect(passed.startsWith('data:image/png;base64,')).toBe(true);
        expect(passed).not.toContain('localhost');
        restoreEnv();
      });

      it('passes a remote URL through unchanged', async () => {
        mockGenerateTextWithModel.mockResolvedValueOnce('{"x":0.5,"y":0.5}');
        const { service } = setup([], [], visionDefaults());

        await service.detectFocalPoint('https://cdn.example.com/photo.jpg', {
          orgId: 'org-1',
        });

        expect(mockGenerateTextWithModel.mock.calls.at(-1)![4].imageUrl).toBe(
          'https://cdn.example.com/photo.jpg',
        );
        restoreEnv();
      });

      it('returns the centred fallback for a local upload it cannot read', async () => {
        // No file written — the provider could never have fetched it either.
        const { service } = setup([], [], visionDefaults());

        const result = await service.detectFocalPoint(
          'http://localhost:4200/uploads/missing.png',
          { orgId: 'org-1' },
        );

        expect(result).toEqual({ x: 0.5, y: 0.5, source: 'fallback' });
        expect(mockGenerateTextWithModel).not.toHaveBeenCalled();
        restoreEnv();
      });

      it('refuses a traversal attempt out of the upload root', async () => {
        const { service } = setup([], [], visionDefaults());

        const result = await service.detectFocalPoint(
          'http://localhost:4200/uploads/..%2F..%2Fetc%2Fpasswd',
          { orgId: 'org-1' },
        );

        expect(result).toEqual({ x: 0.5, y: 0.5, source: 'fallback' });
        expect(mockGenerateTextWithModel).not.toHaveBeenCalled();
        restoreEnv();
      });
    });
  });

  // ── 4F summary ──

  describe('getMediaProviderSummary (4F)', () => {
    it('returns one entry per media operation, all unavailable without an org', async () => {
      const service = bareService();
      const summary = await service.getMediaProviderSummary();

      expect(summary.map((e) => e.operation)).toEqual([
        'image',
        'video',
        'audio',
        'avatar',
        'tts',
        'stt',
        'upscale',
        'bg-remove',
        'inpaint',
        'outpaint',
        'focal-point',
        'slide',
        'caption',
        'video-bg',
        'video-upscale',
      ]);
      expect(summary.every((e) => e.available === false)).toBe(true);
      expect(summary.every((e) => e.providers.length === 0)).toBe(true);
    });

    it('marks operations available per adapter capability and never leaks credentials', async () => {
      const adapter = makeAdapter('replicate', { image: true, upscale: true });
      const { service, orgSettings } = setup([adapter]);
      orgSettings.getEnabledProviders.mockResolvedValue([
        {
          identifier: 'replicate',
          storageProviderId: null,
          storageRootFolderId: null,
          extraConfig: { c2paAvailable: true },
        },
      ]);

      const summary = await service.getMediaProviderSummary('org-1');
      const image = summary.find((e) => e.operation === 'image')!;
      const video = summary.find((e) => e.operation === 'video')!;

      expect(image.available).toBe(true);
      expect(image.providers).toEqual([{ id: 'replicate', enabled: true, c2paAvailable: true }]);
      expect(video.available).toBe(false);

      const serialized = JSON.stringify(summary);
      expect(serialized).not.toContain('credentials');
      expect(serialized).not.toContain('replicate-key');
    });

    it('honours extraConfig.operations gating in the summary', async () => {
      const adapter = makeAdapter('replicate', { image: true, upscale: true });
      const { service, orgSettings } = setup([adapter]);
      orgSettings.getEnabledProviders.mockResolvedValue([
        {
          identifier: 'replicate',
          storageProviderId: null,
          storageRootFolderId: null,
          extraConfig: { operations: ['upscale'] },
        },
      ]);

      const summary = await service.getMediaProviderSummary('org-1');
      expect(summary.find((e) => e.operation === 'image')!.available).toBe(false);
      expect(summary.find((e) => e.operation === 'upscale')!.available).toBe(true);
    });
  });

  describe('listGenerationProviders', () => {
    it('filters candidates by operation capability (a video-only provider is not listed for image)', async () => {
      const openai = makeAdapter('openai', { image: true });
      const runway = makeAdapter('runway', { video: true });
      const { service } = setup([openai, runway]);

      const imageList = await service.listGenerationProviders('org-1', 'image');
      const videoList = await service.listGenerationProviders('org-1', 'video');

      expect(imageList.providers.map((p) => p.identifier)).toEqual(['openai']);
      expect(videoList.providers.map((p) => p.identifier)).toEqual(['runway']);
    });

    it('maps each candidate to identifier + display name and leaks nothing else', async () => {
      const openai = makeAdapter('openai', { image: true }, { name: 'OpenAI' });
      const { service } = setup([openai]);

      const result = await service.listGenerationProviders('org-1', 'image');

      expect(result.providers).toEqual([{ identifier: 'openai', name: 'OpenAI' }]);
      expect(JSON.stringify(result)).not.toContain('openai-key');
    });

    it('excludes providers that are not enabled for the org', async () => {
      const openai = makeAdapter('openai', { image: true });
      const disabled = makeAdapter('replicate', { image: true });
      // Only openai comes back from getEnabledProviders — replicate's row is off.
      const { service } = setup([openai, disabled], ['openai']);

      const result = await service.listGenerationProviders('org-1', 'image');

      expect(result.providers.map((p) => p.identifier)).toEqual(['openai']);
    });

    it('excludes enabled providers whose credentials resolve empty', async () => {
      const openai = makeAdapter('openai', { image: true });
      const replicate = makeAdapter('replicate', { image: true });
      const { service, orgSettings } = setup([openai, replicate]);
      orgSettings.getConfigForProvider.mockImplementation(async (_orgId: string, id: string) => ({
        credentials: id === 'replicate' ? {} : { apiKey: `${id}-key` },
        storageProviderId: null,
        storageRootFolderId: null,
      }));

      const result = await service.listGenerationProviders('org-1', 'image');

      expect(result.providers.map((p) => p.identifier)).toEqual(['openai']);
    });

    it('honours extraConfig.operations gating', async () => {
      const replicate = makeAdapter('replicate', { image: true, upscale: true });
      const { service, orgSettings } = setup([replicate]);
      orgSettings.getEnabledProviders.mockResolvedValue([
        {
          identifier: 'replicate',
          storageProviderId: null,
          storageRootFolderId: null,
          extraConfig: { operations: ['upscale'] },
        },
      ]);

      const result = await service.listGenerationProviders('org-1', 'image');

      expect(result.providers).toEqual([]);
    });

    it('never lists a TTS-flagged adapter for the audio (music) operation', async () => {
      const speechHub = makeAdapter('openai', { audio: true, tts: true });
      const music = makeAdapter('suno', { audio: true, tts: false });
      const { service } = setup([speechHub, music]);

      const result = await service.listGenerationProviders('org-1', 'audio');

      expect(result.providers.map((p) => p.identifier)).toEqual(['suno']);
    });

    it('returns the org resolved default (providerId + model) for the operation category', async () => {
      const openai = makeAdapter('openai', { image: true });
      const defaultsResolution = {
        resolve: vi.fn().mockResolvedValue({
          providerId: 'openai',
          version: 'v1',
          model: 'gpt-image-1',
          source: 'org',
        }),
      };
      const { service } = setup([openai], undefined, defaultsResolution);

      const result = await service.listGenerationProviders('org-1', 'image');

      expect(result.default).toEqual({ providerId: 'openai', model: 'gpt-image-1' });
      // image with no sourceUrl resolves the text-to-image category.
      expect(defaultsResolution.resolve).toHaveBeenCalledWith('media', 'text-to-image', 'org-1');
    });

    it('maps a model-less resolved default to model: null', async () => {
      const openai = makeAdapter('openai', { tts: true });
      const defaultsResolution = {
        resolve: vi.fn().mockResolvedValue({ providerId: 'openai', version: 'v1', source: 'auto' }),
      };
      const { service } = setup([openai], undefined, defaultsResolution);

      const result = await service.listGenerationProviders('org-1', 'tts');

      expect(result.default).toEqual({ providerId: 'openai', model: null });
      expect(defaultsResolution.resolve).toHaveBeenCalledWith('media', 'text-to-speech', 'org-1');
    });

    it('returns default: null when nothing is configured', async () => {
      const openai = makeAdapter('openai', { image: true });
      const defaultsResolution = { resolve: vi.fn().mockResolvedValue(null) };
      const { service } = setup([openai], undefined, defaultsResolution);

      const result = await service.listGenerationProviders('org-1', 'image');

      expect(result.default).toBeNull();
      expect(result.providers.map((p) => p.identifier)).toEqual(['openai']);
    });
  });

  describe('invalidateProviderCache', () => {
    it('clears the lazy infra singletons without throwing', () => {
      const service = bareService();
      expect(() => service.invalidateProviderCache()).not.toThrow();
    });
  });

  describe('untracked async path (no lifecycle service wired)', () => {
    it('submits and returns the raw provider job id', async () => {
      const adapter = makeAdapter('luma', { video: true });
      const map = new Map([[adapter.identifier, adapter]]);
      const orgSettings = {
        getEnabledProviders: vi.fn().mockResolvedValue([
          { identifier: 'luma', storageProviderId: null, storageRootFolderId: null, extraConfig: {} },
        ]),
        getConfigForProvider: vi.fn().mockResolvedValue({
          credentials: { apiKey: 'k' },
          storageProviderId: null,
          storageRootFolderId: null,
        }),
      };
      const service = new AiMediaService(
        new (AiSettingsService as never)(),
        new (AIModelProvider as never)(),
        new (AiSettingsManager as never)(),
        { resolveMedia: (id: string) => map.get(id) } as never,
        undefined as never,
        orgSettings as never,
        // no lifecycle
      );

      const result = await service.generateVideo('a sunset', { orgId: 'org-1' });
      expect(result).toBe('luma-job-1');
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'luma', operation: 'video' }),
      );
    });

    it('throws CapabilityNotAvailable when org media settings are unavailable (audio path)', async () => {
      const adapter = makeAdapter('fal', { audio: true }, {
        generateAudio: vi.fn().mockRejectedValue(new Error('down')),
      });
      const map = new Map([[adapter.identifier, adapter]]);
      const orgSettings = {
        getEnabledProviders: vi.fn().mockResolvedValue([
          { identifier: 'fal', storageProviderId: null, storageRootFolderId: null, extraConfig: {} },
        ]),
        getConfigForProvider: vi.fn().mockResolvedValue({
          credentials: { apiKey: 'k' },
          storageProviderId: null,
          storageRootFolderId: null,
        }),
      };
      // Note: orgSettings is passed as _defaultsResolution here; _orgMediaProviderSettings
      // stays undefined, so resolution returns no candidates before any adapter is called.
      const service = new AiMediaService(
        new (AiSettingsService as never)(),
        new (AIModelProvider as never)(),
        new (AiSettingsManager as never)(),
        { resolveMedia: (id: string) => map.get(id) } as never,
        orgSettings as never,
      );

      await expect(service.generateAudio('a jingle', { orgId: 'org-1' })).rejects.toThrow(
        CapabilityNotAvailable,
      );
    });

    it('tolerates a failing org-settings lookup (resolution returns empty)', async () => {
      const orgSettings = {
        getEnabledProviders: vi.fn().mockRejectedValue(new Error('db down')),
        getConfigForProvider: vi.fn(),
      };
      const service = new AiMediaService(
        new (AiSettingsService as never)(),
        new (AIModelProvider as never)(),
        new (AiSettingsManager as never)(),
        { resolveMedia: () => undefined } as never,
        orgSettings as never,
      );
      const result = await service.generateImage('a cat', { orgId: 'org-1' });
      expect(result).toBe('https://cdn.example.com/image.png');
    });
  });
});
