import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';

vi.mock('@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service', () => ({
  AiSettingsService: class {
    private _summaryCalls = 0;
    getSpendSummary = vi.fn().mockImplementation((_orgId?: string, since?: Date) => {
      this._summaryCalls += 1;
      if (!since) return Promise.resolve([{ _sum: { costUsd: 5 }, scope: 'generator' }]);
      return Promise.resolve([
        { _sum: { costUsd: this._summaryCalls === 2 ? 2 : 0.5 }, scope: 'generator' },
      ]);
    });
    getUsageSummary = vi.fn().mockResolvedValue({
      byScope: [{ _sum: { costUsd: 5 }, scope: 'generator' }],
      totalSpendUsd: 5,
      monthlySpendUsd: 2,
      dailySpendUsd: 0.5,
      budget: {
        monthlyCap: 10,
        dailyCap: 1,
        remainingMonthly: 8,
        remainingDaily: 0.5,
      },
    });
    upsertBrandProfile = vi.fn().mockImplementation((orgId: string, data: any) => ({ organizationId: orgId, ...data }));
    getBrandProfile = vi.fn().mockResolvedValue({ instructions: 'Be professional', language: 'en' });
    getPromptTemplates = vi.fn().mockResolvedValue([]);
    upsertPromptTemplate = vi.fn().mockResolvedValue({});
    deletePromptTemplate = vi.fn().mockResolvedValue({});
    getPromptLibraryItems = vi.fn().mockResolvedValue([]);
    createPromptLibraryItem = vi.fn().mockResolvedValue({});
    deletePromptLibraryItem = vi.fn().mockResolvedValue({});
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/ai-settings.manager', () => ({
  AiSettingsManager: class {
    getSettings = vi.fn().mockResolvedValue({ budgetSettings: { monthlyCap: 10, dailyCap: 1 } });
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/media.service', () => ({
  AiMediaService: class {
    generateImage = vi.fn().mockResolvedValue('https://cdn/image.png');
    generateVideo = vi.fn().mockResolvedValue('https://cdn/video.mp4');
    upscaleImage = vi.fn().mockResolvedValue('https://cdn/upscaled.png');
    removeBackground = vi.fn().mockResolvedValue('https://cdn/nobg.png');
    inpaintImage = vi.fn().mockResolvedValue('https://cdn/inpainted.png');
    textToSpeech = vi.fn().mockResolvedValue(Buffer.from('audio-bytes'));
    speechToText = vi.fn().mockResolvedValue('transcribed text');
    getMediaProviderSummary = vi.fn().mockResolvedValue([
      { operation: 'image', available: true, providers: [{ id: 'replicate', enabled: true, c2paAvailable: true }] },
      { operation: 'tts', available: false, providers: [] },
    ]);
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/rag.service', () => ({
  RagService: class {
    search = vi.fn().mockRejectedValue(new Error('not wired'));
    searchBrandMemory = vi.fn().mockResolvedValue([]);
    indexTopPerformingPosts = vi.fn().mockResolvedValue({ indexed: 3 });
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    generateText = vi.fn().mockResolvedValue('Suggested reply from AI');
    generateObject = vi.fn().mockImplementation((_scope: string, _prompt: string, schema: any) => {
      if (schema?.shape?.variants) return { variants: [{ tone: 'casual', content: 'Variant 1' }] };
      if (schema?.shape?.translations) return { translations: [{ locale: 'fr', text: 'Bonjour' }] };
      return { platforms: [{ platform: 'twitter', content: 'Test tweet' }] };
    });
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/guardrail.service', () => ({
  GuardrailService: class { },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/budget.service', () => ({
  BudgetService: class { },
}));

vi.mock('@gitroom/nestjs-libraries/analytics/analytics.service', () => ({
  AnalyticsService: class {
    getBestTimeAnalyticsContext = vi.fn().mockResolvedValue({
      integrations: [{ id: 'int-1', name: 'Twitter', providerIdentifier: 'x', picture: null }],
      posts: [{ id: 'p-1', publishDate: new Date('2024-06-01T09:00:00Z'), integrationId: 'int-1', lastViews: 100, lastLikes: 10, lastComments: 3 }],
      snapshots: [{ id: 's-1', organizationId: 'org-1', integrationId: 'int-1', metric: 'likes', value: 5, date: new Date('2024-06-01') }],
    });
  },
}));

import { AiUserController } from './ai-user.controller';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { CapabilityNotAvailable } from '@gitroom/nestjs-libraries/ai/governance/errors';

const mockOrg = { id: 'org-1', name: 'Test Org' } as any;
const mockUser = { id: 'user-1', email: 'u@test.com' } as any;

describe('AiUserController', () => {
  let controller: AiUserController;
  let aiSettings: AiSettingsService;
  let settingsManager: AiSettingsManager;
  let mediaService: AiMediaService;
  let ragService: RagService;
  let aiModelProvider: AIModelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    aiSettings = new (AiSettingsService as any)();
    settingsManager = new (AiSettingsManager as any)();
    mediaService = new (AiMediaService as any)();
    ragService = new (RagService as any)();
    aiModelProvider = new (AIModelProvider as any)();
    controller = new AiUserController(
      aiSettings as any,
      settingsManager as any,
      mediaService as any,
      ragService as any,
      aiModelProvider as any,
      {} as GuardrailService,
      {} as BudgetService,
      new (AnalyticsService as any)(),
      {} as any,
    );
  });

  describe('getUsage', () => {
    it('returns the usage summary from the service', async () => {
      const result = await controller.getUsage(mockOrg);
      expect(result).toEqual({
        byScope: [{ _sum: { costUsd: 5 }, scope: 'generator' }],
        totalSpendUsd: 5,
        monthlySpendUsd: 2,
        dailySpendUsd: 0.5,
        budget: {
          monthlyCap: 10,
          dailyCap: 1,
          remainingMonthly: 8,
          remainingDaily: 0.5,
        },
      });
      expect(aiSettings.getUsageSummary).toHaveBeenCalledWith(mockOrg.id);
    });
  });

  describe('getMediaProviders (4F)', () => {
    it('returns the credential-free media provider summary', async () => {
      const result = await controller.getMediaProviders(mockOrg);
      expect(mediaService.getMediaProviderSummary).toHaveBeenCalledTimes(1);
      expect(mediaService.getMediaProviderSummary).toHaveBeenCalledWith(mockOrg.id);
      expect(result).toEqual([
        { operation: 'image', available: true, providers: [{ id: 'replicate', enabled: true, c2paAvailable: true }] },
        { operation: 'tts', available: false, providers: [] },
      ]);
      expect(JSON.stringify(result)).not.toContain('credentials');
    });
  });

  describe('brand-profile', () => {
    it('upserts brand profile', async () => {
      const result = await controller.upsertBrandProfile(mockOrg, { instructions: 'Be funny' });
      expect(result.organizationId).toBe('org-1');
      expect(result.instructions).toBe('Be funny');
    });

    it('gets brand profile', async () => {
      const result: any = await controller.getBrandProfile(mockOrg);
      expect(result.instructions).toBe('Be professional');
    });
  });

  describe('prompt-templates', () => {
    it('lists templates', async () => {
      const result = await controller.getPromptTemplates(mockOrg);
      expect(Array.isArray(result)).toBe(true);
    });

    it('upserts a template', async () => {
      const result = await controller.upsertPromptTemplate(mockOrg, { key: 'utility.generatePosts', content: 'Write in French' });
      expect(result).toBeDefined();
    });
  });

  describe('prompt-library', () => {
    it('lists library items', async () => {
      const result = await controller.getPromptLibrary(mockOrg);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('comment-reply', () => {
    it('returns a drafted reply', async () => {
      const result = await controller.draftCommentReply(mockOrg, { commentId: 'c-1', postContent: 'Great post!' });
      expect(result).toHaveProperty('suggestion');
    });
  });

  describe('best-time', () => {
    it('returns suggestion with analytics data', async () => {
      const result: any = await controller.bestTimeToPost(mockOrg);
      expect(result).toHaveProperty('suggestion');
      expect(result.hasAnalyticsData).toBe(true);
    });
  });

  describe('repurpose', () => {
    it('returns repurposed content for platforms', async () => {
      const result: any = await controller.repurposeContent(mockOrg, { content: 'Hello world', platforms: ['twitter', 'linkedin'] });
      expect(result).toHaveProperty('platforms');
      expect(Array.isArray(result.platforms)).toBe(true);
    });
  });

  describe('translate', () => {
    it('returns translated content', async () => {
      const result: any = await controller.translateContent(mockOrg, { content: 'Hello', locales: ['fr', 'es'] });
      expect(result).toHaveProperty('translations');
      expect(Array.isArray(result.translations)).toBe(true);
    });
  });

  describe('variants', () => {
    it('returns content variants with tones', async () => {
      const result: any = await controller.generateVariants(mockOrg, { content: 'Buy now', count: 2 });
      expect(result).toHaveProperty('variants');
      expect(Array.isArray(result.variants)).toBe(true);
    });
  });

  describe('media job', () => {
    it('image → generateImage returns url', async () => {
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'image',
        prompt: 'a cat',
        size: '1024x1024',
      });
      expect(result).toEqual({ url: 'https://cdn/image.png' });
      expect(mediaService.generateImage).toHaveBeenCalledWith('a cat', {
        size: '1024x1024',
        orgId: 'org-1',
        userId: 'user-1',
      });
    });

    it('video → generateVideo returns url', async () => {
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'video',
        prompt: 'a dog running',
      });
      expect(result).toEqual({ url: 'https://cdn/video.mp4' });
      expect(mediaService.generateVideo).toHaveBeenCalledWith('a dog running', {
        orgId: 'org-1',
        userId: 'user-1',
      });
    });

    it('upscale → upscaleImage returns url', async () => {
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'upscale',
        imageUrl: 'https://cdn/in.png',
      });
      expect(result).toEqual({ url: 'https://cdn/upscaled.png' });
      expect(mediaService.upscaleImage).toHaveBeenCalledWith('https://cdn/in.png', {
        orgId: 'org-1',
      });
    });

    it('bg-remove → removeBackground returns url', async () => {
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'bg-remove',
        imageUrl: 'https://cdn/in.png',
      });
      expect(result).toEqual({ url: 'https://cdn/nobg.png' });
      expect(mediaService.removeBackground).toHaveBeenCalledWith('https://cdn/in.png', {
        orgId: 'org-1',
      });
    });

    it('inpaint → inpaintImage returns url', async () => {
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'inpaint',
        imageUrl: 'https://cdn/in.png',
        maskUrl: 'https://cdn/mask.png',
        prompt: 'add a hat',
      });
      expect(result).toEqual({ url: 'https://cdn/inpainted.png' });
      expect(mediaService.inpaintImage).toHaveBeenCalledWith(
        'https://cdn/in.png',
        'https://cdn/mask.png',
        'add a hat',
        { orgId: 'org-1' },
      );
    });

    it('tts → textToSpeech returns base64 audio', async () => {
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'tts',
        text: 'hello world',
        voice: 'alloy',
      });
      expect(result).toEqual({ audio: Buffer.from('audio-bytes').toString('base64') });
      expect(mediaService.textToSpeech).toHaveBeenCalledWith('hello world', {
        voice: 'alloy',
        orgId: 'org-1',
        userId: 'user-1',
      });
    });

    it('stt → speechToText returns text', async () => {
      const audioB64 = Buffer.from('raw-audio').toString('base64');
      const result: any = await controller.createMediaJob(mockOrg, mockUser, {
        operation: 'stt',
        audio: audioB64,
      });
      expect(result).toEqual({ text: 'transcribed text' });
      const callArgs = (mediaService.speechToText as any).mock.calls[0];
      expect(Buffer.isBuffer(callArgs[0])).toBe(true);
      expect(callArgs[0].toString()).toBe('raw-audio');
      expect(callArgs[1]).toEqual({ orgId: 'org-1', userId: 'user-1' });
    });

    it('unknown operation → 400', async () => {
      await expect(
        controller.createMediaJob(mockOrg, mockUser, { operation: 'bogus' } as any),
      ).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_REQUEST }),
      );
    });

    it('maps CapabilityNotAvailable → 503 with real message', async () => {
      (mediaService.generateImage as any).mockRejectedValueOnce(
        new CapabilityNotAvailable('Image generation is not available', 'image'),
      );
      await expect(
        controller.createMediaJob(mockOrg, mockUser, { operation: 'image', prompt: 'x' }),
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Image generation is not available',
        }),
      );
    });

    it('maps unexpected error → 500', async () => {
      (mediaService.generateVideo as any).mockRejectedValueOnce(new Error('boom'));
      await expect(
        controller.createMediaJob(mockOrg, mockUser, { operation: 'video', prompt: 'x' }),
      ).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.INTERNAL_SERVER_ERROR }),
      );
    });
  });

  describe('search', () => {
    it('returns 503 when RAG is not wired', async () => {
      await expect(controller.search(mockOrg, { query: 'test' })).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.SERVICE_UNAVAILABLE }),
      );
    });
  });

  describe('coverage of remaining handlers', () => {
    it('deletePromptTemplate delegates to the service', async () => {
      const result = await controller.deletePromptTemplate(mockOrg, 'utility.generatePosts');
      expect(aiSettings.deletePromptTemplate).toHaveBeenCalledWith(mockOrg.id, 'utility.generatePosts');
      expect(result).toEqual({ success: true });
    });

    it('createPromptLibraryItem delegates to the service', async () => {
      const result = await controller.createPromptLibraryItem(mockOrg, {
        title: 'Test',
        content: 'Content',
      });
      expect(aiSettings.createPromptLibraryItem).toHaveBeenCalledWith({
        organizationId: mockOrg.id,
        title: 'Test',
        content: 'Content',
      });
      expect(result).toBeDefined();
    });

    it('generateHashtags returns hashtags from the model', async () => {
      (aiModelProvider as any).generateObject = vi.fn().mockResolvedValueOnce({
        hashtags: ['#hello', '#world'],
      });
      const result: any = await controller.generateHashtags(mockOrg, {
        content: 'Hello world',
        platform: 'twitter',
      });
      expect(result.hashtags).toEqual(['#hello', '#world']);
    });

    it('checkCompliance returns compliance result', async () => {
      (aiModelProvider as any).generateObject = vi.fn().mockResolvedValueOnce({
        passed: true,
        violations: [],
        suggestions: ['Keep it up'],
      });
      const result: any = await controller.checkCompliance(mockOrg, {
        content: 'Nice post',
        platform: 'x',
      });
      expect(result.passed).toBe(true);
    });

    it('draftCommentReply returns sentiment analysis', async () => {
      (aiModelProvider as any).generateObject = vi.fn().mockResolvedValueOnce({
        comments: [{ content: 'Nice', sentiment: 'positive', confidence: 0.9 }],
        overallSentiment: 'positive',
      });
      const result: any = await controller.draftCommentReply(mockOrg, {
        commentId: 'c-1',
        postContent: 'Great post!',
        action: 'sentiment',
      });
      expect(result.overallSentiment).toBe('positive');
    });

    it('draftCommentReply returns summary analysis', async () => {
      (aiModelProvider as any).generateObject = vi.fn().mockResolvedValueOnce({
        summary: 'A summary',
        keyPoints: ['Point 1'],
        actionItems: ['Action 1'],
      });
      const result: any = await controller.draftCommentReply(mockOrg, {
        commentId: 'c-1',
        postContent: 'Great post!',
        action: 'summary',
      });
      expect(result.summary).toBe('A summary');
    });

    it('indexBrandMemory returns indexing result', async () => {
      const result = await controller.indexBrandMemory(mockOrg, mockUser);
      expect(result).toEqual({ indexed: 3 });
    });

    it('searchBrandMemory returns hits', async () => {
      const result = await controller.searchBrandMemory(mockOrg, { prompt: 'campaign' } as any);
      expect(result).toEqual({ hits: [] });
    });
  });
});
