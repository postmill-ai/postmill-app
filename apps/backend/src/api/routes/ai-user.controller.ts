import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsOptional, IsNumber, IsBoolean, Min } from 'class-validator';
import { Organization, User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { CapabilityNotAvailable } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { RequirePermission } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { PROMPT_CONSTANTS } from '@gitroom/nestjs-libraries/ai/prompt-constants.const';
import { BrandMemorySearchDto } from '@gitroom/backend/dtos/ai/brand-memory-search.dto';
import dayjs from 'dayjs';

class UpsertBrandProfileDto {
  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  platformInstructions?: Record<string, string>;

  @IsOptional()
  languageProfiles?: Record<string, { instructions?: string; overrides?: Record<string, string> }>;

  @IsOptional()
  logoFileIds?: string[];

  @IsOptional()
  palette?: Array<{ name?: string; hex?: string }>;

  @IsOptional()
  fontFamilies?: Array<{ name?: string; fallback?: string }>;

  @IsOptional()
  customFonts?: Array<{ fileId: string; family?: string }>;

  @IsOptional()
  enforcement?: Record<string, unknown>;

  @IsOptional()
  assets?: Array<{ fileId: string; url?: string; caption?: string }>;
}

class ComplianceCheckDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  platform?: string;
}

class UpsertPromptTemplateDto {
  @IsString()
  key!: string;

  @IsString()
  content!: string;
}

class CreatePromptLibraryItemDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;
}

class MediaJobDto {
  @IsString()
  operation!: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  maskUrl?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  voice?: string;

  // base64-encoded audio payload (for speech-to-text)
  @IsOptional()
  @IsString()
  audio?: string;
}

class SearchQueryDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number;
}

class HashtagsDto {
  @IsString()
  content!: string;

  @IsString()
  platform!: string;
}

class CommentActionDto {
  @IsString()
  commentId!: string;

  @IsString()
  postContent!: string;

  @IsOptional()
  @IsString()
  action?: 'reply' | 'sentiment' | 'summary';
}

class CommentReplyDto {
  @IsString()
  commentId!: string;

  @IsString()
  postContent!: string;
}

class RepurposeDto {
  @IsString()
  content!: string;

  @IsString({ each: true })
  platforms!: string[];
}

class TranslateDto {
  @IsString()
  content!: string;

  @IsString({ each: true })
  locales!: string[];
}

class VariantsDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  count?: number;
}

@ApiTags('AI User')
@Controller('/ai')
export class AiUserController {
  private readonly _logger = new Logger(AiUserController.name);

  constructor(
    private _aiSettingsService: AiSettingsService,
    private _aiSettingsManager: AiSettingsManager,
    private _aiMediaService: AiMediaService,
    private _ragService: RagService,
    private _aiModelProvider: AIModelProvider,
    private _guardrails: GuardrailService,
    private _budget: BudgetService,
    private _analyticsService: AnalyticsService,
    private _aiDefaults: AiDefaultsService,
  ) {}

  @Get('/usage')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getUsage(@GetOrgFromRequest() org: Organization) {
    return this._aiSettingsService.getUsageSummary(org.id);
  }

  @Get('/media-providers')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getMediaProviders(@GetOrgFromRequest() org: Organization) {
    return this._aiMediaService.getMediaProviderSummary(org.id);
  }

  @Put('/brand-profile')
  @RequirePermission('ai-config', 'update')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async upsertBrandProfile(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpsertBrandProfileDto,
  ) {
    return this._aiSettingsService.upsertBrandProfile(org.id, body);
  }

  @Get('/brand-profile')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getBrandProfile(@GetOrgFromRequest() org: Organization, @Query('brandId') brandId?: string) {
    const profile = await this._aiSettingsService.getBrandProfile(org.id, brandId);
    return profile || {};
  }

  @Get('/prompt-templates')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getPromptTemplates(@GetOrgFromRequest() org: Organization) {
    return this._aiSettingsService.getPromptTemplates(org.id);
  }

  @Put('/prompt-templates')
  @RequirePermission('ai-config', 'update')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async upsertPromptTemplate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpsertPromptTemplateDto,
  ) {
    return this._aiSettingsService.upsertPromptTemplate(
      org.id,
      body.key,
      body.content,
    );
  }

  @Delete('/prompt-templates/:key')
  @RequirePermission('ai-config', 'delete')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async deletePromptTemplate(
    @GetOrgFromRequest() org: Organization,
    @Param('key') key: string,
  ) {
    await this._aiSettingsService.deletePromptTemplate(org.id, key);
    return { success: true };
  }

  @Get('/prompt-library')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async getPromptLibrary(@GetOrgFromRequest() org: Organization) {
    return this._aiSettingsService.getPromptLibraryItems(org.id);
  }

  @Post('/prompt-library')
  @RequirePermission('ai-config', 'create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async createPromptLibraryItem(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreatePromptLibraryItemDto,
  ) {
    return this._aiSettingsService.createPromptLibraryItem({
      organizationId: org.id,
      title: body.title,
      content: body.content,
    });
  }

  @Delete('/prompt-library/:id')
  @RequirePermission('ai-config', 'delete')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async deletePromptLibraryItem(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
  ) {
    await this._aiSettingsService.deletePromptLibraryItem(id, org.id);
    return { success: true };
  }

  @Post('/media')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async createMediaJob(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: MediaJobDto,
  ) {
    const orgId = org.id;
    const userId = user?.id;

    try {
      switch (body.operation) {
        case 'image': {
          const url = await this._aiMediaService.generateImage(
            body.prompt || '',
            { size: body.size, orgId, userId },
          );
          return { url };
        }
        case 'video': {
          const url = await this._aiMediaService.generateVideo(
            body.prompt || '',
            { orgId, userId },
          );
          return { url };
        }
        case 'audio': {
          const jobId = await this._aiMediaService.generateAudio(
            body.prompt || body.text || '',
            { orgId, userId, voice: body.voice },
          );
          return { jobId };
        }
        case 'avatar': {
          const jobId = await this._aiMediaService.generateAvatar(
            body.prompt || '',
            { orgId, userId, sourceUrl: body.imageUrl },
          );
          return { jobId };
        }
        case 'upscale': {
          const url = await this._aiMediaService.upscaleImage(
            body.imageUrl || '',
            { orgId },
          );
          return { url };
        }
        case 'bg-remove': {
          const url = await this._aiMediaService.removeBackground(
            body.imageUrl || '',
            { orgId },
          );
          return { url };
        }
        case 'inpaint': {
          const url = await this._aiMediaService.inpaintImage(
            body.imageUrl || '',
            body.maskUrl || '',
            body.prompt || '',
            { orgId },
          );
          return { url };
        }
        case 'tts': {
          const buffer = await this._aiMediaService.textToSpeech(
            body.text || '',
            { voice: body.voice, orgId, userId },
          );
          return { audio: buffer.toString('base64') };
        }
        case 'stt': {
          const text = await this._aiMediaService.speechToText(
            Buffer.from(body.audio || '', 'base64'),
            { orgId, userId },
          );
          return { text };
        }
        case 'alt-text': {
          const { altText } = await this._aiDefaults.altText(
            orgId,
            body.imageUrl || '',
          );
          return { altText };
        }
        default:
          throw new HttpException(
            `Unknown media operation: ${body.operation}`,
            HttpStatus.BAD_REQUEST,
          );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if (err instanceof CapabilityNotAvailable) {
        throw new HttpException(err.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      this._logger.error(
        `media operation '${body.operation}' failed for org ${orgId}: ${(err as Error).message}`,
      );
      throw new HttpException(
        (err as Error).message || 'Media operation failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('/search')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async search(
    @GetOrgFromRequest() org: Organization,
    @Query() query: SearchQueryDto,
  ) {
    try {
      return await this._ragService.search({
        organizationId: org.id,
        query: query.query,
        limit: query.limit || 10,
      });
    } catch (err) {
      throw new HttpException(
        (err as Error).message || 'Semantic search is not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Post('/hashtags')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async generateHashtags(
    @GetOrgFromRequest() org: Organization,
    @Body() body: HashtagsDto,
  ) {
    try {
      const hashtagsSchema = z.object({
        hashtags: z.array(z.string()).describe('Generated hashtags for the post'),
      });

      const platformNames: Record<string, string> = {
        x: 'X/Twitter',
        twitter: 'X/Twitter',
        linkedin: 'LinkedIn',
        instagram: 'Instagram',
        facebook: 'Facebook',
        threads: 'Threads',
        tiktok: 'TikTok',
        youtube: 'YouTube',
        pinterest: 'Pinterest',
      };

      const platformName = platformNames[body.platform.toLowerCase()] || body.platform;
      const prompt = `Generate 15-20 relevant hashtags for this ${platformName} post.

Post content:
"${body.content}"

Include a mix of popular and niche hashtags. Return only the hashtags array.`;

      const result = await this._aiModelProvider.generateObject<
        z.infer<typeof hashtagsSchema>
      >('utility', prompt, hashtagsSchema, {
        system: `You are a social media hashtag expert. Generate platform-optimized hashtags for ${platformName}.`,
        orgId: org.id,
      });

      return result;
    } catch (err) {
      this._logger.error(
        `hashtags failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Hashtag generation is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/comment-reply')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async draftCommentReply(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CommentActionDto,
  ) {
    const action = body.action || 'reply';

    if (action === 'sentiment') {
      try {
        const sentimentSchema = z.object({
          comments: z.array(z.object({
            content: z.string(),
            sentiment: z.enum(['positive', 'negative', 'neutral']),
            confidence: z.number().min(0).max(1),
          })).describe('Per-comment sentiment analysis'),
          overallSentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
        });

        const prompt = `Analyze the sentiment of each comment in this thread and provide an overall sentiment assessment.

Post content:
"${body.postContent}"

For each comment, determine if the sentiment is positive, negative, or neutral, with a confidence score (0-1).`;

        const result = await this._aiModelProvider.generateObject<
          z.infer<typeof sentimentSchema>
        >('agent', prompt, sentimentSchema, {
          system: 'You are a social media sentiment analysis expert. Analyze comments for positive, negative, or neutral sentiment.',
          orgId: org.id,
        });

        return result;
      } catch (err) {
        this._logger.error(
          `comment sentiment failed for org ${org.id}: ${(err as Error).message}`,
        );
        throw new HttpException(
          'Sentiment analysis is temporarily unavailable',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    if (action === 'summary') {
      try {
        const summarySchema = z.object({
          summary: z.string().describe('Concise summary of the comment thread discussion'),
          keyPoints: z.array(z.string()).describe('Key points raised in the discussion'),
          actionItems: z.array(z.string()).describe('Suggested action items from the discussion'),
        });

        const prompt = `Summarize the discussion in this comment thread for a social media post.

Post content:
"${body.postContent}"

Provide a concise summary, key points raised, and suggested action items.`;

        const result = await this._aiModelProvider.generateObject<
          z.infer<typeof summarySchema>
        >('agent', prompt, summarySchema, {
          system: 'You are a social media community manager. Summarize comment discussions and extract actionable insights.',
          orgId: org.id,
        });

        return result;
      } catch (err) {
        this._logger.error(
          `comment summary failed for org ${org.id}: ${(err as Error).message}`,
        );
        throw new HttpException(
          'Comment summary is temporarily unavailable',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    const prompt = `The post content is: "${body.postContent}"

Draft a friendly, professional reply from the social media manager's perspective. Keep the reply concise, engaging, and on-brand.`;

    const reply = await this._aiModelProvider.generateText(
      'agent',
      prompt,
      {
        system:
          'You are a helpful social media assistant. Draft a reply to a comment on a social media post.',
        orgId: org.id,
      },
    );

    return { suggestion: reply };
  }

  @Post('/best-time')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async bestTimeToPost(@GetOrgFromRequest() org: Organization) {
    try {
      const context = await this._analyticsService.getBestTimeAnalyticsContext(
        org.id,
      );

      const { integrations, posts, snapshots } = context;
      const hasData = posts.length > 0 || snapshots.length > 0;

      const channelEngagement: Record<string, { name: string; totalEngagement: number }> = {};
      for (const snap of snapshots) {
        if (!channelEngagement[snap.integrationId]) {
          const int = integrations.find((i) => i.id === snap.integrationId);
          channelEngagement[snap.integrationId] = {
            name: int?.name || snap.integrationId,
            totalEngagement: 0,
          };
        }
        channelEngagement[snap.integrationId].totalEngagement += snap.value;
      }

      const postHours = posts.map((p) => ({
        hour: dayjs(p.publishDate).hour(),
        integrationId: p.integrationId,
        views: p.lastViews || 0,
        likes: p.lastLikes || 0,
        comments: p.lastComments || 0,
      }));

      const analyticsContext = hasData
        ? JSON.stringify({
            channels: integrations.map((i) => ({
              id: i.id,
              name: i.name,
              platform: i.providerIdentifier,
            })),
            channelEngagement: Object.entries(channelEngagement).map(
              ([id, data]) => ({
                channelId: id,
                name: data.name,
                totalEngagement: data.totalEngagement,
              }),
            ),
            postTiming: postHours.slice(0, 100),
            totalPosts: posts.length,
          })
        : 'No analytics data available for this organization yet.';

      const system =
        'You are a social media scheduling expert. Analyze the provided analytics data (post timing patterns and channel engagement metrics) and suggest optimal posting time slots for each channel. If data is sparse, provide evidence-based general best practices.';

      const suggestion = await this._aiModelProvider.generateText(
        'utility',
        analyticsContext,
        {
          system,
          orgId: org.id,
        },
      );

      return { suggestion, hasAnalyticsData: hasData };
    } catch (err) {
      this._logger.error(
        `best-time failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Best time analysis is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/repurpose')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async repurposeContent(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RepurposeDto,
  ) {
    try {
      const repurposeSchema = z.object({
        platforms: z
          .array(
            z.object({
              platform: z.string(),
              content: z.string(),
              note: z.string().optional(),
            }),
          )
          .describe('Repurposed content for each requested platform'),
      });

      const platformDescriptions: Record<string, string> = {
        twitter: 'short, punchy, under 280 characters, use hashtags wisely',
        x: 'short, punchy, under 280 characters, use hashtags wisely',
        linkedin:
          'professional tone, 1-3 paragraphs, industry insights, thought leadership',
        blog: 'long-form, detailed, SEO-friendly, structured with headings',
        instagram:
          'visual description first, engaging caption with emojis, hashtag block at the end',
        facebook:
          'conversational, friendly, may include questions to drive engagement',
        threads: 'casual, conversational, text-first, under 500 characters',
        mastodon:
          'conversational, content-warning aware, descriptive alt-text mindset',
      };

      const platformList = body.platforms
        .map(
          (p) =>
            `- ${p}: ${platformDescriptions[p.toLowerCase()] || 'adapt naturally to this platform\'s style'}`,
        )
        .join('\n');

      const prompt = `Rewrite the following content for each of these platforms. Match each platform's native tone and format conventions.

Original content:
"${body.content}"

Platform requirements:
${platformList}

Return exactly ${body.platforms.length} results, one per requested platform.`;

      const result = await this._aiModelProvider.generateObject<
        z.infer<typeof repurposeSchema>
      >('utility', prompt, repurposeSchema, {
        system:
          'You are an expert social media content strategist. Adapt content for different platforms while preserving the core message.',
        orgId: org.id,
      });

      return result;
    } catch (err) {
      this._logger.error(
        `repurpose failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Content repurposing is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/compliance')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async checkCompliance(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ComplianceCheckDto,
  ) {
    try {
      const schema = z.object({
        passed: z.boolean(),
        violations: z.array(
          z.object({
            type: z.string(),
            severity: z.enum(['high', 'medium', 'low']),
            description: z.string(),
          }),
        ),
        suggestions: z.array(z.string()),
      });

      const prompt = PROMPT_CONSTANTS.checkCompliance(body.content, body.platform);

      const result = await this._aiModelProvider.generateObject<
        z.infer<typeof schema>
      >('utility', prompt, schema, {
        system:
          'You are a content compliance checker. Analyze social media content for policy violations, brand safety concerns, and regulatory issues.',
        orgId: org.id,
      });

      return result;
    } catch (err) {
      this._logger.error(
        `compliance check failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Compliance check is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/translate')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async translateContent(
    @GetOrgFromRequest() org: Organization,
    @Body() body: TranslateDto,
  ) {
    try {
      const translateSchema = z.object({
        translations: z
          .array(
            z.object({
              locale: z.string(),
              text: z.string(),
            }),
          )
          .describe('Translated content for each requested locale'),
      });

      const localeList = body.locales.join(', ');

      const prompt = `Translate the following content into these locales: ${localeList}.

Original content:
"${body.content}"

For each locale, provide an accurate translation that preserves the meaning, tone, and style of the original. Adapt idioms and cultural references as needed.`;

      const result = await this._aiModelProvider.generateObject<
        z.infer<typeof translateSchema>
      >('utility', prompt, translateSchema, {
        system:
          'You are an expert multilingual translator. Provide accurate, natural-sounding translations that preserve the original meaning and tone.',
        orgId: org.id,
      });

      return result;
    } catch (err) {
      this._logger.error(
        `translate failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Translation is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/brand-memory/index')
  @RequirePermission('ai-config', 'update')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async indexBrandMemory(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    try {
      const result = await this._ragService.indexTopPerformingPosts(
        org.id,
        10,
        user?.id,
      );
      return result;
    } catch (err) {
      this._logger.error(
        `brand-memory index failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Brand memory indexing is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/brand-memory/search')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async searchBrandMemory(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BrandMemorySearchDto,
  ) {
    try {
      const hits = await this._ragService.searchBrandMemory(
        org.id,
        body.prompt,
      );
      return { hits };
    } catch (err) {
      this._logger.error(
        `brand-memory search failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Brand memory search is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/variants')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async generateVariants(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VariantsDto,
  ) {
    try {
      const count = body.count || 3;

      const variantsSchema = z.object({
        variants: z
          .array(
            z.object({
              tone: z.string().describe('The tone or angle of this variant'),
              content: z
                .string()
                .describe('The rewritten content for this variant'),
            }),
          )
          .describe(`${count} content variants with different tones/styles`),
      });

      const prompt = `Generate ${count} different variants of the following content. Each variant should use a different tone, angle, or approach to test what resonates best with the audience.

Original content:
"${body.content}"

Choose ${count} distinct tones from options like: professional, casual, humorous, urgent, emotional, authoritative, friendly, provocative, educational, inspirational.`;

      const result = await this._aiModelProvider.generateObject<
        z.infer<typeof variantsSchema>
      >('utility', prompt, variantsSchema, {
        system:
          'You are a creative copywriter specialized in A/B testing content. Generate distinct, quality variants that each take a different approach to the same message.',
        orgId: org.id,
      });

      return result;
    } catch (err) {
      this._logger.error(
        `variants failed for org ${org.id}: ${(err as Error).message}`,
      );
      throw new HttpException(
        'Variant generation is temporarily unavailable',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
