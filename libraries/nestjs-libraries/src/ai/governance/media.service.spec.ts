import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityNotAvailable } from './errors';

const mockImageModelGenerate = vi.fn().mockResolvedValue('https://cdn.example.com/image.png');
const mockImageModel = vi.fn().mockResolvedValue({
  generate: mockImageModelGenerate,
});
const mockGenerateTextWithModel = vi.fn().mockResolvedValue('{"x":0.5,"y":0.5}');

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class MockProvider {
    imageModel = mockImageModel;
    generateTextWithModel = mockGenerateTextWithModel;
  },
}));

const mockCreateMediaJob = vi.fn().mockResolvedValue({ id: 'job-1' });
const mockCreateSpendLog = vi.fn();

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class MockAiSettings {
    createMediaJob = mockCreateMediaJob;
    createSpendLog = mockCreateSpendLog;
  },
}));

const mockRecordSpend = vi.fn();
vi.mock('@gitroom/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class MockBudget {
    recordSpend = mockRecordSpend;
    checkBudget = vi.fn().mockResolvedValue({ allowed: true });
  },
}));

const mockGetSettings = vi.fn().mockResolvedValue(null);

vi.mock('@gitroom/nestjs-libraries/ai/ai-settings.manager', () => ({
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
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import {
  MediaProviderAdapter,
  MediaProviderCapabilities,
} from '@gitroom/nestjs-libraries/media/media-provider-adapter.interface';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';

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

    it('records a media job with cost + creditType when orgId is provided', async () => {
      const service = bareService();
      await service.generateImage('a cat', { orgId: 'org-123', userId: 'user-1' });
      expect(mockCreateMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-123',
          userId: 'user-1',
          provider: 'ai-media',
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
          provider: 'ai-media',
          model: 'ai-media',
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
