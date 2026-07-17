import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetExceeded, GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';

import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { OpenaiService, PROMPT_CONSTANTS } from './openai.service';

function mockAIModelProvider() {
  const mockLanguageModel = {
    modelId: 'gpt-4.1',
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Alt-text description of the image' }],
      usage: { inputTokens: 5, outputTokens: 10 },
    }),
  };

  const mockImageGenerator = {
    generate: vi.fn().mockResolvedValue('https://cdn.example.com/image.png'),
  };

  const provider: any = {
    imageModel: vi.fn().mockResolvedValue(mockImageGenerator),
    generateText: vi.fn().mockResolvedValue('Generated text response'),
    generateObject: vi.fn().mockResolvedValue({}),
    languageModel: vi.fn().mockResolvedValue(mockLanguageModel),
    resolveProviderRef: vi.fn().mockResolvedValue({ providerId: 'openai', version: 'v1' }),
    hasCapability: vi.fn().mockReturnValue(true),
  };

  return { provider, mockLanguageModel, mockImageGenerator };
}

describe('OpenaiService', () => {
  let service: OpenaiService;
  let aiModelProvider: AIModelProvider;
  let aiMediaService: { generateImage: ReturnType<typeof vi.fn> };
  let mocks: ReturnType<typeof mockAIModelProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = mockAIModelProvider();
    aiModelProvider = mocks.provider as unknown as AIModelProvider;
    aiMediaService = {
      generateImage: vi.fn().mockResolvedValue('https://cdn.example.com/image.png'),
    };
    service = new OpenaiService(aiModelProvider, aiMediaService as unknown as AiMediaService);
  });

  describe('generateImage (§10.3 — routed through the media surface)', () => {
    it('delegates to AiMediaService.generateImage with the prompt', async () => {
      const result = await service.generateImage('a dragon in flight');

      expect(aiMediaService.generateImage).toHaveBeenCalledWith('a dragon in flight', {
        size: '1024x1024',
        orgId: undefined,
      });
      expect(result).toBe('https://cdn.example.com/image.png');
    });

    it('uses vertical size when isVertical is true', async () => {
      await service.generateImage('a dragon', true);

      expect(aiMediaService.generateImage).toHaveBeenCalledWith('a dragon', {
        size: '1024x1536',
        orgId: undefined,
      });
    });

    it('threads orgId through to the media surface', async () => {
      await service.generateImage('prompt', false, 'org-42');

      expect(aiMediaService.generateImage).toHaveBeenCalledWith('prompt', {
        size: '1024x1024',
        orgId: 'org-42',
      });
    });
  });

  describe('generatePromptForPicture', () => {
    it('calls generateObject with scope "utility"', async () => {
      mocks.provider.generateObject.mockResolvedValue({ prompt: 'a cinematic shot of mountains' });

      const result = await service.generatePromptForPicture('mountain landscape', 'org-1');

      expect(aiModelProvider.generateObject).toHaveBeenCalledWith(
        'utility',
        'prompt: mountain landscape',
        expect.any(Object),
        {
          system: PROMPT_CONSTANTS.generatePromptForPicture,
          orgId: 'org-1',
        },
      );
      expect(result).toBe('a cinematic shot of mountains');
    });

    it('returns empty string when response has no prompt', async () => {
      mocks.provider.generateObject.mockResolvedValue({ prompt: '' });

      const result = await service.generatePromptForPicture('test');

      expect(result).toBe('');
    });

    it('works without orgId', async () => {
      mocks.provider.generateObject.mockResolvedValue({ prompt: 'test prompt' });

      await service.generatePromptForPicture('something');

      expect(aiModelProvider.generateObject).toHaveBeenCalledWith(
        'utility',
        'prompt: something',
        expect.any(Object),
        expect.objectContaining({ orgId: undefined }),
      );
    });
  });

  describe('generateVoiceFromText', () => {
    it('calls generateObject with scope "utility"', async () => {
      mocks.provider.generateObject.mockResolvedValue({ voice: 'Hello... welcome to our channel' });

      const result = await service.generateVoiceFromText('Welcome to our channel', 'org-2');

      expect(aiModelProvider.generateObject).toHaveBeenCalledWith(
        'utility',
        'prompt: Welcome to our channel',
        expect.any(Object),
        {
          system: PROMPT_CONSTANTS.generateVoiceFromText,
          orgId: 'org-2',
        },
      );
      expect(result).toBe('Hello... welcome to our channel');
    });

    it('returns empty string when response has no voice', async () => {
      mocks.provider.generateObject.mockResolvedValue({});

      const result = await service.generateVoiceFromText('test');

      expect(result).toBe('');
    });
  });

  describe('generatePosts', () => {
    it('calls generateObject twice with scope "utility" for twitter and thread', async () => {
      mocks.provider.generateObject
        .mockResolvedValueOnce({ post: 'Tweet content' })
        .mockResolvedValueOnce({ posts: [{ post: 'Thread part 1' }, { post: 'Thread part 2' }] });

      const result = await service.generatePosts('Some content', 'org-3');

      expect(aiModelProvider.generateObject).toHaveBeenCalledTimes(2);
      expect(aiModelProvider.generateObject).toHaveBeenNthCalledWith(
        1,
        'utility',
        'Some content',
        expect.any(Object),
        expect.objectContaining({ system: PROMPT_CONSTANTS.generatePostsTwitter, orgId: 'org-3' }),
      );
      expect(aiModelProvider.generateObject).toHaveBeenNthCalledWith(
        2,
        'utility',
        'Some content',
        expect.any(Object),
        expect.objectContaining({ system: PROMPT_CONSTANTS.generatePostsThread, orgId: 'org-3' }),
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles missing posts array in thread response', async () => {
      mocks.provider.generateObject
        .mockResolvedValueOnce({ post: 'Tweet' })
        .mockResolvedValueOnce({});

      const result = await service.generatePosts('content');

      expect(result.length).toBe(1);
    });
  });

  describe('extractWebsiteText', () => {
    it('calls generateText with scope "utility" then generatePosts', async () => {
      mocks.provider.generateText.mockResolvedValue('Extracted article text');
      mocks.provider.generateObject
        .mockResolvedValueOnce({ post: 'Post' })
        .mockResolvedValueOnce({ posts: [{ post: 'Thread' }] });

      const result = await service.extractWebsiteText('<html>full page</html>', 'org-4');

      expect(aiModelProvider.generateText).toHaveBeenCalledWith(
        'utility',
        '<html>full page</html>',
        {
          system: PROMPT_CONSTANTS.extractWebsiteText,
          orgId: 'org-4',
        },
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('separatePosts', () => {
    it('calls generateObject with scope "utility"', async () => {
      mocks.provider.generateObject.mockResolvedValue({ posts: ['Part 1', 'Part 2', 'Part 3'] });

      const result = await service.separatePosts('Long content to split', 280);

      expect(aiModelProvider.generateObject).toHaveBeenCalledWith(
        'utility',
        'Long content to split',
        expect.any(Object),
        {
          system: PROMPT_CONSTANTS.separatePosts(280),
        },
      );
      expect(result.posts).toEqual(['Part 1', 'Part 2', 'Part 3']);
    });

    it('shrinks posts that exceed length with retries', async () => {
      const longPost = 'a'.repeat(300);
      mocks.provider.generateObject.mockResolvedValueOnce({ posts: [longPost] });

      mocks.provider.generateObject.mockResolvedValueOnce({ post: 'Shrunk post' });

      const result = await service.separatePosts('Long content', 100);

      expect(aiModelProvider.generateObject).toHaveBeenLastCalledWith(
        'utility',
        longPost,
        expect.any(Object),
        {
          system: PROMPT_CONSTANTS.separatePostShrink(100),
        },
      );
      expect(result.posts[0]).toBe('Shrunk post');
    });

    it('returns empty posts array when response is null', async () => {
      mocks.provider.generateObject.mockResolvedValue(null);

      const result = await service.separatePosts('content', 100);

      expect(result.posts).toEqual([]);
    });

    it('falls back to original post when retries exhausted', async () => {
      const longPost = 'a'.repeat(300);
      mocks.provider.generateObject.mockResolvedValueOnce({ posts: [longPost] });

      mocks.provider.generateObject.mockRejectedValue(new Error('AI error'));

      const result = await service.separatePosts('Long content', 100);

      expect(result.posts[0]).toBe(longPost);
    });
  });

  describe('generateSlidesFromText', () => {
    it('calls generateObject with scope "utility"', async () => {
      mocks.provider.generateObject.mockResolvedValue({
        slides: [
          { imagePrompt: 'Slide 1 prompt', voiceText: 'Slide 1 voice' },
          { imagePrompt: 'Slide 2 prompt', voiceText: 'Slide 2 voice' },
        ],
      });

      const result = await service.generateSlidesFromText('Presentation text');

      expect(aiModelProvider.generateObject).toHaveBeenCalledWith(
        'utility',
        'Presentation text',
        expect.any(Object),
        {
          system: PROMPT_CONSTANTS.generateSlidesFromText,
        },
      );
      expect(result).toHaveLength(2);
      expect(result[0].imagePrompt).toBe('Slide 1 prompt');
    });

    it('returns empty array on failure after all retries', async () => {
      mocks.provider.generateObject.mockRejectedValue(new Error('Failed'));

      const result = await service.generateSlidesFromText('text');

      expect(result).toEqual([]);
      expect(aiModelProvider.generateObject).toHaveBeenCalledTimes(3);
    });

    it('re-throws BudgetExceeded immediately', async () => {
      mocks.provider.generateObject.mockRejectedValue(
        new BudgetExceeded('Budget exceeded', 'utility', 'org-1'),
      );

      await expect(service.generateSlidesFromText('text')).rejects.toThrow(BudgetExceeded);
      expect(aiModelProvider.generateObject).toHaveBeenCalledTimes(1);
    });

    it('re-throws GuardrailViolation immediately', async () => {
      mocks.provider.generateObject.mockRejectedValue(
        new GuardrailViolation('Guardrail violation', 'utility'),
      );

      await expect(service.generateSlidesFromText('text')).rejects.toThrow(GuardrailViolation);
      expect(aiModelProvider.generateObject).toHaveBeenCalledTimes(1);
    });

    it('succeeds on retry if a transient error occurs first', async () => {
      mocks.provider.generateObject
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({
          slides: [{ imagePrompt: 'Recovered', voiceText: 'Recovered voice' }],
        });

      const result = await service.generateSlidesFromText('text');

      expect(result).toHaveLength(1);
      expect(aiModelProvider.generateObject).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateAltText', () => {
    const imageUrl = 'https://example.com/photo.jpg';

    it('calls languageModel with scope "utility" when vision is supported', async () => {
      mocks.provider.resolveProviderRef.mockResolvedValue({ providerId: 'openai', version: 'v1' });
      mocks.provider.hasCapability.mockReturnValue(true);

      const result = await service.generateAltText(imageUrl, 'org-5');

      expect(aiModelProvider.resolveProviderRef).toHaveBeenCalledWith('utility', 'org-5');
      expect(aiModelProvider.hasCapability).toHaveBeenCalledWith('openai', 'vision', 'v1');
      expect(aiModelProvider.languageModel).toHaveBeenCalledWith('utility', 'org-5');
      expect(result).toBe('Alt-text description of the image');
    });

    it('falls back to generateText when vision is not supported', async () => {
      mocks.provider.resolveProviderRef.mockResolvedValue({ providerId: 'openai', version: 'v1' });
      mocks.provider.hasCapability.mockReturnValue(false);

      const result = await service.generateAltText(imageUrl, 'org-6');

      expect(aiModelProvider.languageModel).not.toHaveBeenCalled();
      expect(aiModelProvider.generateText).toHaveBeenCalledWith(
        'utility',
        expect.stringContaining(imageUrl),
        expect.objectContaining({
          system: PROMPT_CONSTANTS.generateAltText,
          orgId: 'org-6',
        }),
      );
      expect(result).toBe('Generated text response');
    });

    it('returns empty string on error', async () => {
      mocks.provider.resolveProviderRef.mockResolvedValue({ providerId: 'openai', version: 'v1' });
      mocks.provider.hasCapability.mockReturnValue(true);
      mocks.provider.languageModel.mockRejectedValue(new Error('Model error'));

      const result = await service.generateAltText(imageUrl);

      expect(result).toBe('');
    });
  });
});
