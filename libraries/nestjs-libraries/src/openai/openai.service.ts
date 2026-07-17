import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { shuffle } from 'lodash';
import { z } from 'zod';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { BudgetExceeded, GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { PROMPT_CONSTANTS } from '@gitroom/nestjs-libraries/ai/prompt-constants.const';
export { PROMPT_CONSTANTS };

const PicturePrompt = z.object({
  prompt: z.string(),
});

const VoicePrompt = z.object({
  voice: z.string(),
});

const SeparatePostsPrompt = z.object({
  posts: z.array(z.string()),
});

const SeparatePostPrompt = z.object({
  post: z.string().max(10000),
});

const SlidesSchema = z.object({
  slides: z
    .array(
      z.object({
        imagePrompt: z.string(),
        voiceText: z.string(),
      })
    )
    .describe('an array of slides'),
});

@Injectable()
export class OpenaiService {
  private readonly _logger = new Logger(OpenaiService.name);

  constructor(
    @Inject(forwardRef(() => AIModelProvider))
    private readonly _aiModelProvider: AIModelProvider,
    private readonly _aiMediaService: AiMediaService,
  ) {}

  // §10.3: image generation routes through the media surface (org media providers
  // first, AI-facade imageModel() fallback inside AiMediaService).
  async generateImage(prompt: string, isVertical = false, orgId?: string) {
    return this._aiMediaService.generateImage(prompt, {
      size: isVertical ? '1024x1536' : '1024x1024',
      orgId,
    });
  }

  async generatePromptForPicture(prompt: string, orgId?: string) {
    const result = await this._aiModelProvider.generateObject<{ prompt: string }>(
      'utility',
      `prompt: ${prompt}`,
      PicturePrompt,
      {
        system: PROMPT_CONSTANTS.generatePromptForPicture,
        orgId,
      },
    );
    return result?.prompt || '';
  }

  async generateVoiceFromText(prompt: string, orgId?: string) {
    try {
      const result = await this._aiModelProvider.generateObject<{ voice: string }>(
        'utility',
        `prompt: ${prompt}`,
        VoicePrompt,
        {
          system: PROMPT_CONSTANTS.generateVoiceFromText,
          orgId,
        },
      );
      return result?.voice || '';
    } catch (err) {
      if (err instanceof BudgetExceeded || err instanceof GuardrailViolation) {
        throw err;
      }
      this._logger.error(`generateVoiceFromText failed: ${(err as Error)?.message}`);
      return '';
    }
  }

  async generatePosts(content: string, orgId?: string) {
    const TwitterPostSchema = z.object({ post: z.string() });
    const ThreadPostSchema = z.object({ posts: z.array(z.object({ post: z.string() })) });

    const posts = (
      await Promise.all([
        this._aiModelProvider.generateObject<{ post: string }>('utility', content!, TwitterPostSchema, {
          system: PROMPT_CONSTANTS.generatePostsTwitter,
          orgId,
        }).then(r => [r]),
        this._aiModelProvider.generateObject<{ posts: { post: string }[] }>('utility', content!, ThreadPostSchema, {
          system: PROMPT_CONSTANTS.generatePostsThread,
          orgId,
        }).then(r => r.posts || []),
      ])
    ).flat();

    return shuffle(
      (Array.isArray(posts) ? posts : [posts]).flat().map((post: any) => {
        if (post?.post) return [{ post: post.post }];
        if (Array.isArray(post)) return post;
        return post;
      }).flat()
    );
  }

  async extractWebsiteText(content: string, orgId?: string) {
    const articleContent = await this._aiModelProvider.generateText(
      'utility',
      content,
      {
        system: PROMPT_CONSTANTS.extractWebsiteText,
        orgId,
      },
    );

    return this.generatePosts(articleContent, orgId);
  }

  async separatePosts(content: string, len: number) {
    const posts = await this._aiModelProvider.generateObject<{ posts: string[] }>(
      'utility',
      content,
      SeparatePostsPrompt,
      {
        system: PROMPT_CONSTANTS.separatePosts(len),
      },
    );

    return {
      posts: await Promise.all(
        (posts?.posts || []).map(async (post: string) => {
          if (post.length <= len) {
            return post;
          }

          let retries = 4;
          while (retries) {
            try {
              const result = await this._aiModelProvider.generateObject<{ post: string }>(
                'utility',
                post,
                SeparatePostPrompt,
                {
                  system: PROMPT_CONSTANTS.separatePostShrink(len),
                },
              );
              return result?.post || post;
            } catch {
              retries--;
            }
          }

          return post;
        }),
      ),
    };
  }

  async generateSlidesFromText(text: string) {
    for (let i = 0; i < 3; i++) {
      try {
        const result = await this._aiModelProvider.generateObject<{ slides: { imagePrompt: string; voiceText: string }[] }>(
          'utility',
          text,
          SlidesSchema,
          {
            system: PROMPT_CONSTANTS.generateSlidesFromText,
          },
        );
        return result?.slides || [];
      } catch (err) {
        if (err instanceof BudgetExceeded || err instanceof GuardrailViolation) {
          throw err;
        }
        this._logger.error(
          `generateSlidesFromText attempt failed: ${(err as Error)?.message}`,
          OpenaiService.name,
        );
      }
    }

    this._logger.error('generateSlidesFromText failed after 3 retries', OpenaiService.name);
    return [];
  }

  async generateAltText(imageUrlOrB64: string, orgId?: string) {
    try {
      const { providerId, version } = await this._aiModelProvider.resolveProviderRef(
        'utility',
        orgId,
      );
      const hasVision = this._aiModelProvider.hasCapability(providerId, 'vision', version);

      if (hasVision) {
        const model = await this._aiModelProvider.languageModel('utility', orgId);
        const result = await (model as any).doGenerate({
          prompt: [
            { role: 'system', content: [{ type: 'text', text: PROMPT_CONSTANTS.generateAltText }] },
            { role: 'user', content: [
              { type: 'text', text: PROMPT_CONSTANTS.generateAltTextVisionPrompt },
              { type: 'image', image: imageUrlOrB64 },
            ]},
          ],
        });
        const extractText = (r: any): string =>
          typeof r?.text === 'string'
            ? r.text
            : (Array.isArray(r?.content) ? r.content : [])
                .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
                .map((p: any) => p.text)
                .join('');
        return extractText(result).trim();
      }

      // Fallback: pass image URL as text hint (no vision capability)
      const result = await this._aiModelProvider.generateText('utility',
        PROMPT_CONSTANTS.generateAltTextFallbackPrompt(imageUrlOrB64), {
        system: PROMPT_CONSTANTS.generateAltText,
        orgId,
      });
      return result.trim();
    } catch (err) {
      this._logger.error(`generateAltText failed: ${(err as Error)?.message}`);
      return '';
    }
  }
}
