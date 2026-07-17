import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiDefaultsService } from './ai-defaults.service';
import { bustDefaultsCatalogCache as mockBustCache } from './defaults-cache';

vi.mock('./defaults-cache', () => ({
  bustDefaultsCatalogCache: vi.fn(),
}));
import { DefaultsResolutionService } from './defaults-resolution.service';
import { AIModelProvider } from '../ai-model.provider';
import { AiMediaService } from '../governance/media.service';
import { DefaultNotConfiguredError } from './defaults.errors';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { DefaultsSettingsValidator } from './defaults-settings.validator';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';

describe('AiDefaultsService', () => {
  const mockResolution = {
    resolve: vi.fn(),
    resolveAll: vi.fn(),
    candidates: vi.fn(),
  } as unknown as DefaultsResolutionService;

  const mockModelProvider = {
    generateTextWithModel: vi.fn(),
  } as unknown as AIModelProvider;

  const mockMediaService = {
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
    textToSpeech: vi.fn(),
    generateAudio: vi.fn(),
    upscaleImage: vi.fn(),
    removeBackground: vi.fn(),
    inpaintImage: vi.fn(),
    detectFocalPoint: vi.fn(),
    generateSlide: vi.fn(),
    generateAvatar: vi.fn(),
    captionVideo: vi.fn(),
    removeVideoBackground: vi.fn(),
    upscaleVideo: vi.fn(),
  } as unknown as AiMediaService;

  const mockDefaultsRepository = {
    getAll: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
  } as unknown as OrgDefaultModelRepository;

  const mockSettingsValidator = {
    validate: vi.fn((_domain, _category, settings) => settings),
  } as unknown as DefaultsSettingsValidator;

  const mockProviderResolution = {
    resolveAI: vi.fn(),
  } as unknown as ProviderResolutionService;

  const mockKernel = {
    listManifests: vi.fn(),
    versions: vi.fn(),
    latestActive: vi.fn(),
    get: vi.fn(),
  };

  const mockOrgAiSettings = {
    getActiveProvider: vi.fn(),
    getProviders: vi.fn(),
    getByIdentifier: vi.fn(),
  } as unknown as OrgAiSettingsService;

  let service: AiDefaultsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AiDefaultsService(
      mockResolution,
      mockModelProvider,
      mockMediaService,
      mockDefaultsRepository,
      mockSettingsValidator,
      mockProviderResolution,
      mockKernel as any,
      mockOrgAiSettings,
    );
  });

  describe('text utilities', () => {
    it('lowReasoningText resolves ai/low-reasoning and generates text', async () => {
      vi.mocked(mockResolution.resolve).mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
        source: 'auto',
      });
      vi.mocked(mockModelProvider.generateTextWithModel).mockResolvedValue('hello');

      const result = await service.lowReasoningText('org-1', 'prompt');

      expect(result).toBe('hello');
      expect(mockResolution.resolve).toHaveBeenCalledWith('ai', 'low-reasoning', 'org-1');
      expect(mockModelProvider.generateTextWithModel).toHaveBeenCalledWith(
        'org-1',
        'openai',
        'v1',
        'gpt-4.1',
        { prompt: 'prompt' },
      );
    });

    it('highReasoningText resolves ai/high-reasoning', async () => {
      vi.mocked(mockResolution.resolve).mockResolvedValue({
        providerId: 'anthropic',
        version: 'v1',
        model: 'claude-opus',
        source: 'auto',
      });
      vi.mocked(mockModelProvider.generateTextWithModel).mockResolvedValue('reasoned');

      const result = await service.highReasoningText('org-1', 'prompt');

      expect(mockResolution.resolve).toHaveBeenCalledWith('ai', 'high-reasoning', 'org-1');
      expect(result).toBe('reasoned');
    });

    it('workflow resolves ai/workflow with messages', async () => {
      vi.mocked(mockResolution.resolve).mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
        source: 'auto',
      });
      vi.mocked(mockModelProvider.generateTextWithModel).mockResolvedValue('done');
      const messages = [{ role: 'user', content: 'hi' }];

      const result = await service.workflow('org-1', messages, { temperature: 0.5 });

      expect(mockResolution.resolve).toHaveBeenCalledWith('ai', 'workflow', 'org-1');
      expect(mockModelProvider.generateTextWithModel).toHaveBeenCalledWith(
        'org-1',
        'openai',
        'v1',
        'gpt-4.1',
        { messages, temperature: 0.5 },
      );
      expect(result).toBe('done');
    });

    it('vision resolves ai/vision with imageUrl and prompt', async () => {
      vi.mocked(mockResolution.resolve).mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4o',
        source: 'auto',
      });
      vi.mocked(mockModelProvider.generateTextWithModel).mockResolvedValue('a cat');

      const result = await service.vision('org-1', 'https://img', 'describe');

      expect(mockResolution.resolve).toHaveBeenCalledWith('ai', 'vision', 'org-1');
      expect(mockModelProvider.generateTextWithModel).toHaveBeenCalledWith(
        'org-1',
        'openai',
        'v1',
        'gpt-4o',
        { imageUrl: 'https://img', prompt: 'describe' },
      );
      expect(result).toBe('a cat');
    });

    it('altText resolves ai/vision and returns { altText }', async () => {
      vi.mocked(mockResolution.resolve).mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4o',
        source: 'auto',
      });
      vi.mocked(mockModelProvider.generateTextWithModel).mockResolvedValue('A red bicycle');

      const result = await service.altText('org-1', 'https://img');

      expect(mockResolution.resolve).toHaveBeenCalledWith('ai', 'vision', 'org-1');
      expect(mockModelProvider.generateTextWithModel).toHaveBeenCalledWith(
        'org-1',
        'openai',
        'v1',
        'gpt-4o',
        expect.objectContaining({ imageUrl: 'https://img' }),
      );
      expect(result).toEqual({ altText: 'A red bicycle' });
    });

    it('throws DefaultNotConfiguredError when the default is missing', async () => {
      vi.mocked(mockResolution.resolve).mockResolvedValue(null);

      await expect(service.lowReasoningText('org-1', 'prompt')).rejects.toBeInstanceOf(
        DefaultNotConfiguredError,
      );
    });
  });

  describe('media utilities', () => {
    // F-3: every media utility resolves a default first. Success-path tests need a
    // non-null resolution so the guard passes; the null-default cases are asserted below.
    beforeEach(() => {
      vi.mocked(mockResolution.resolve).mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'some-model',
        source: 'auto',
      });
    });

    it('textToImage delegates to AiMediaService.generateImage with text input', async () => {
      vi.mocked(mockMediaService.generateImage).mockResolvedValue('url');
      const result = await service.textToImage('org-1', 'a cat');
      expect(result).toBe('url');
      expect(mockMediaService.generateImage).toHaveBeenCalledWith('a cat', { orgId: 'org-1' });
    });

    it('imageToImage passes sourceUrl', async () => {
      vi.mocked(mockMediaService.generateImage).mockResolvedValue('url');
      await service.imageToImage('org-1', 'prompt', 'https://img');
      expect(mockMediaService.generateImage).toHaveBeenCalledWith('prompt', {
        orgId: 'org-1',
        sourceUrl: 'https://img',
      });
    });

    it('textToVideo delegates to generateVideo', async () => {
      vi.mocked(mockMediaService.generateVideo).mockResolvedValue('id');
      await service.textToVideo('org-1', 'prompt');
      expect(mockMediaService.generateVideo).toHaveBeenCalledWith('prompt', { orgId: 'org-1' });
    });

    it('imageToVideo passes sourceUrl', async () => {
      vi.mocked(mockMediaService.generateVideo).mockResolvedValue('id');
      await service.imageToVideo('org-1', 'prompt', 'https://img');
      expect(mockMediaService.generateVideo).toHaveBeenCalledWith('prompt', {
        orgId: 'org-1',
        sourceUrl: 'https://img',
      });
    });

    it('videoToVideo passes category video-to-video so resolver prefers it over image-to-video', async () => {
      vi.mocked(mockMediaService.generateVideo).mockResolvedValue('id');
      await service.videoToVideo('org-1', 'prompt', 'https://video');
      expect(mockMediaService.generateVideo).toHaveBeenCalledWith('prompt', {
        orgId: 'org-1',
        sourceUrl: 'https://video',
        category: 'video-to-video',
      });
    });

    it('textToSpeech delegates with voice option', async () => {
      vi.mocked(mockMediaService.textToSpeech).mockResolvedValue(Buffer.from('audio'));
      await service.textToSpeech('org-1', 'hello', { voice: 'alloy' });
      expect(mockMediaService.textToSpeech).toHaveBeenCalledWith('hello', {
        orgId: 'org-1',
        voice: 'alloy',
      });
    });

    it('textToMusic delegates to generateAudio', async () => {
      vi.mocked(mockMediaService.generateAudio).mockResolvedValue('id');
      await service.textToMusic('org-1', 'prompt');
      expect(mockMediaService.generateAudio).toHaveBeenCalledWith('prompt', { orgId: 'org-1' });
    });

    it('imageUpscale delegates with imageUrl', async () => {
      vi.mocked(mockMediaService.upscaleImage).mockResolvedValue('url');
      await service.imageUpscale('org-1', 'https://img');
      expect(mockMediaService.upscaleImage).toHaveBeenCalledWith('https://img', { orgId: 'org-1' });
    });

    it('imageBgRemove delegates with imageUrl', async () => {
      vi.mocked(mockMediaService.removeBackground).mockResolvedValue('url');
      await service.imageBgRemove('org-1', 'https://img');
      expect(mockMediaService.removeBackground).toHaveBeenCalledWith('https://img', {
        orgId: 'org-1',
      });
    });

    it('imageInpaint delegates with imageUrl, maskUrl, prompt', async () => {
      vi.mocked(mockMediaService.inpaintImage).mockResolvedValue('url');
      await service.imageInpaint('org-1', 'https://img', 'https://mask', 'fix');
      expect(mockMediaService.inpaintImage).toHaveBeenCalledWith(
        'https://img',
        'https://mask',
        'fix',
        { orgId: 'org-1' },
      );
    });

    it('imageFocalPoint delegates to detectFocalPoint', async () => {
      vi.mocked(mockMediaService.detectFocalPoint).mockResolvedValue({
        x: 0.5,
        y: 0.5,
        source: 'fallback',
      });
      await service.imageFocalPoint('org-1', 'https://img');
      expect(mockMediaService.detectFocalPoint).toHaveBeenCalledWith('https://img', {
        orgId: 'org-1',
      });
    });

    it('imageSlide delegates to generateSlide', async () => {
      vi.mocked(mockMediaService.generateSlide).mockResolvedValue('id');
      await service.imageSlide('org-1', 'prompt', ['https://img']);
      expect(mockMediaService.generateSlide).toHaveBeenCalledWith('org-1', 'prompt', [
        'https://img',
      ]);
    });

    it('videoAvatar delegates to generateAvatar with opts', async () => {
      vi.mocked(mockMediaService.generateAvatar).mockResolvedValue('id');
      await service.videoAvatar('org-1', 'script', { imageUrl: 'https://img' });
      expect(mockMediaService.generateAvatar).toHaveBeenCalledWith('script', {
        orgId: 'org-1',
        sourceUrl: 'https://img',
      });
    });

    it('videoCaption delegates to captionVideo', async () => {
      vi.mocked(mockMediaService.captionVideo).mockResolvedValue('id');
      await service.videoCaption('org-1', 'https://video');
      expect(mockMediaService.captionVideo).toHaveBeenCalledWith('org-1', 'https://video');
    });

    it('videoBackground delegates to removeVideoBackground', async () => {
      vi.mocked(mockMediaService.removeVideoBackground).mockResolvedValue('url');
      await service.videoBackground('org-1', 'https://video');
      expect(mockMediaService.removeVideoBackground).toHaveBeenCalledWith('https://video', {
        orgId: 'org-1',
      });
    });

    it('videoUpscale delegates to upscaleVideo', async () => {
      vi.mocked(mockMediaService.upscaleVideo).mockResolvedValue('url');
      await service.videoUpscale('org-1', 'https://video');
      expect(mockMediaService.upscaleVideo).toHaveBeenCalledWith('https://video', {
        orgId: 'org-1',
      });
    });

    describe('null default → throws DefaultNotConfiguredError (F-3)', () => {
      beforeEach(() => {
        vi.mocked(mockResolution.resolve).mockResolvedValue(null);
      });

      const cases: Array<[string, () => Promise<unknown>]> = [
        ['textToImage', () => service.textToImage('org-1', 'p')],
        ['imageToImage', () => service.imageToImage('org-1', 'p', 'https://img')],
        ['textToVideo', () => service.textToVideo('org-1', 'p')],
        ['imageToVideo', () => service.imageToVideo('org-1', 'p', 'https://img')],
        ['videoToVideo', () => service.videoToVideo('org-1', 'p', 'https://video')],
        ['textToSpeech', () => service.textToSpeech('org-1', 'hi')],
        ['textToMusic', () => service.textToMusic('org-1', 'p')],
        ['imageUpscale', () => service.imageUpscale('org-1', 'https://img')],
        ['imageBgRemove', () => service.imageBgRemove('org-1', 'https://img')],
        ['imageInpaint', () => service.imageInpaint('org-1', 'https://img', 'https://mask', 'fix')],
        ['imageFocalPoint', () => service.imageFocalPoint('org-1', 'https://img')],
        ['imageSlide', () => service.imageSlide('org-1', 'p')],
        ['videoAvatar', () => service.videoAvatar('org-1', 'script')],
        ['videoCaption', () => service.videoCaption('org-1', 'https://video')],
        ['videoBackground', () => service.videoBackground('org-1', 'https://video')],
        ['videoUpscale', () => service.videoUpscale('org-1', 'https://video')],
      ];

      it.each(cases)('%s throws DefaultNotConfiguredError and does not delegate', async (_name, call) => {
        await expect(call()).rejects.toBeInstanceOf(DefaultNotConfiguredError);
      });
    });
  });

  describe('model defaults', () => {
    beforeEach(() => {
      vi.mocked(mockDefaultsRepository.getAll).mockResolvedValue([]);
      vi.mocked(mockResolution.resolveAll).mockResolvedValue({
        'low-reasoning': { providerId: 'openai', version: 'v1', model: 'gpt-4.1', source: 'auto' },
      });
    });

    it('getModelDefaults returns resolved and stored categories', async () => {
      mockDefaultsRepository.getAll.mockResolvedValue([
        { category: 'low-reasoning', providerId: 'openai', version: 'v1', model: 'gpt-4.1' },
      ]);

      const result = await service.getModelDefaults('org-1');

      expect(result.categories).toHaveLength(4);
      const low = result.categories.find((c: any) => c.category === 'low-reasoning');
      expect(low).toMatchObject({
        category: 'low-reasoning',
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
        source: 'stored',
      });
    });

    it('setModelDefault validates category, sanitizes settings, upserts and busts cache', async () => {
      mockDefaultsRepository.upsert.mockResolvedValue(undefined);
      vi.mocked(mockSettingsValidator.validate).mockReturnValue({ temperature: 0.7 });

      const result = await service.setModelDefault('org-1', 'low-reasoning', {
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
        settings: { prompt: 'ignored', temperature: 0.7 },
      } as any);

      expect(result).toEqual({ category: 'low-reasoning', success: true });
      expect(mockSettingsValidator.validate).toHaveBeenCalledWith(
        'ai',
        'low-reasoning',
        { prompt: 'ignored', temperature: 0.7 },
        { providerId: 'openai', model: 'gpt-4.1' },
      );
      expect(mockDefaultsRepository.upsert).toHaveBeenCalledWith(
        'org-1',
        'ai',
        'low-reasoning',
        expect.objectContaining({ settings: { temperature: 0.7 } }),
      );
    });

    it('clearModelDefault removes a default', async () => {
      mockDefaultsRepository.remove.mockResolvedValue(undefined);
      const result = await service.clearModelDefault('org-1', 'low-reasoning');
      expect(result).toEqual({ category: 'low-reasoning', success: true });
      expect(mockDefaultsRepository.remove).toHaveBeenCalledWith('org-1', 'ai', 'low-reasoning');
    });

    it('rejects invalid model category', async () => {
      await expect(
        service.setModelDefault('org-1', 'not-a-category', { providerId: 'openai' } as any),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('provider catalog', () => {
    it('listProviders enumerates adapters with version metadata', async () => {
      mockProviderResolution.resolveAI.mockReturnValue({
        identifier: 'openai',
        name: 'OpenAI',
        type: 'direct',
        capabilities: { text: true },
        privacy: {},
        credentialFields: [{ key: 'apiKey' }],
      });
      mockKernel.listManifests.mockReturnValue([{ providerId: 'openai', version: 'v1' }]);
      mockKernel.versions.mockReturnValue([{ version: 'v1', status: 'active', credentialFields: [{ key: 'apiKey' }] }]);
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1', status: 'active', credentialFields: [{ key: 'apiKey' }] } });

      const result = await service.listProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        identifier: 'openai',
        name: 'OpenAI',
        version: 'v1',
        status: 'active',
      });
    });

    it('getProviderConfigSummary strips credentials from active provider', async () => {
      mockOrgAiSettings.getActiveProvider.mockResolvedValue({
        identifier: 'openai',
        name: 'OpenAI',
        credentials: { apiKey: 'secret' },
      });
      mockOrgAiSettings.getProviders.mockResolvedValue([]);
      mockKernel.versions.mockReturnValue([]);
      mockKernel.latestActive.mockReturnValue(undefined);

      const result = await service.getProviderConfigSummary('org-1');

      expect(result.active).not.toHaveProperty('credentials');
      expect(result.active).toHaveProperty('identifier', 'openai');
    });

    it('resolveAdapter returns undefined for unknown providers', () => {
      mockProviderResolution.resolveAI.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(service.resolveAdapter('unknown')).toBeUndefined();
    });

    it('bustDefaultsCatalogCache delegates to the standalone helper', () => {
      service.bustDefaultsCatalogCache('org-1');
      expect(mockBustCache).toHaveBeenCalledWith('org-1');
    });
  });
});
