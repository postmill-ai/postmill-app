import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AllProvidersSettings } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { Integration } from '@prisma/client';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  guardOutbound,
  parseOrg,
  parseUser,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';

const validUrlExtension = new ValidUrlExtension();
const validUrlPath = new ValidUrlPath();

// Same URL validation as MediaDto (valid.url.path) - each attachment must
// point to an allowed upload domain and a supported file extension.
const attachmentUrl = z
  .string()
  .refine((url) => validUrlPath.validate(url, {} as any), {
    message: validUrlPath.defaultMessage({} as any),
  })
  .refine((url) => validUrlExtension.validate(url, {} as any), {
    message: validUrlExtension.defaultMessage({} as any),
  });

@Injectable()
export class IntegrationSchedulePostTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _guardrailService: GuardrailService,
    private _subscriptionService: SubscriptionService
  ) {}
  name = 'integrationSchedulePostTool';

  // 1.3 — mirror the HTTP `@CheckPolicies([Create, POSTS_PER_MONTH])` gate that
  // the dashboard/public create routes carry. The MCP entrypoints only check the
  // AI budget, so without this a capped org can schedule unlimited posts through
  // the agent. Returns a quota error string (for the model) when over the cap, or
  // null when the write is allowed.
  private async _postsBudgetError(
    organizationId: string,
    orgCreatedAt: Date | undefined
  ): Promise<string | null> {
    // No billing configured (self-hosted / dev) → no cap, same as the guard's
    // early return when STRIPE_PUBLISHABLE_KEY is unset.
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return null;
    }

    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    const tier = subscription?.subscriptionTier || 'FREE';
    const limit = pricing[tier]?.posts_per_month ?? 0;

    const createdAt =
      (await this._subscriptionService.getSubscription(organizationId))
        ?.createdAt ||
      orgCreatedAt ||
      new Date();
    const totalMonthPast = Math.abs(dayjs(createdAt).diff(dayjs(), 'month'));
    const checkFrom = dayjs(createdAt).add(totalMonthPast, 'month');
    const count = await this._postsService.countPostsFromDay(
      organizationId,
      checkFrom.toDate()
    );

    if (count >= limit) {
      return `Monthly post limit reached for this plan (${limit} posts/month). Upgrade the subscription to schedule more posts.`;
    }
    return null;
  }

  run() {
    return createTool({
      id: 'schedulePostTool',
      mcp: {
        annotations: {
          title: 'Schedule Social Media Post',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
This tool allows you to schedule a post to a social media platform, based on integrationSchema tool.
So for example:

If the user want to post a post to LinkedIn with one comment
- socialPost array length will be one
- postsAndComments array length will be two (one for the post, one for the comment)

If the user want to post 20 posts for facebook each in individual days without comments
- socialPost array length will be 20
- postsAndComments array length will be one

If the tools return errors, you would need to rerun it with the right parameters, don't ask again, just run it
`,
      inputSchema: z.object({
        socialPost: z
          .array(
            z.object({
              integrationId: z
                .string()
                .describe('The id of the integration (not internal id)'),
              isPremium: z
                .boolean()
                .describe(
                  "If the integration is X, return if it's premium or not"
                ),
              date: z.string().describe('The date of the post in UTC time'),
              shortLink: z
                .boolean()
                .describe(
                  'If the post has a link inside, we can ask the user if they want to add a short link'
                ),
              type: z
                .enum(['draft', 'schedule', 'now'])
                .describe(
                  'The type of the post, if we pass now, we should pass the current date also'
                ),
              postsAndComments: z
                .array(
                  z.object({
                    content: z
                      .string()
                      .describe(
                        "The content of the post, HTML, Each line must be wrapped in <p> here is the possible tags: h1, h2, h3, u, strong, li, ul, p (you can't have u and strong together)"
                      ),
                    attachments: z
                      .array(attachmentUrl)
                      .describe('The image of the post (URLS)'),
                  })
                )
                .describe(
                  'first item is the post, every other item is the comments'
                ),
              settings: z
                .array(
                  z.object({
                    key: z
                      .string()
                      .describe('Name of the settings key to pass'),
                    value: z
                      .any()
                      .describe(
                        'Value of the key, always prefer the id then label if possible'
                      ),
                  })
                )
                .describe(
                  'This relies on the integrationSchema tool to get the settings [input:settings]'
                ),
            })
          )
          .describe('Individual post'),
      }),
      outputSchema: z.object({
        output: z
          .array(
            z.object({
              postId: z.string(),
              integration: z.string(),
            })
          )
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const toolContext = context as any;
        requireWrite(toolContext);
        const org = parseOrg(toolContext);
        const organizationId = org.id;
        const userId = parseUser(toolContext).id;
        const finalOutput = [];

        // 1.3 — enforce the POSTS_PER_MONTH cap before creating anything, so the
        // agent path can't bypass the billing gate the HTTP create routes carry.
        const quotaError = await this._postsBudgetError(
          organizationId,
          org.createdAt ? new Date(org.createdAt) : undefined
        );
        if (quotaError) {
          return { errors: quotaError };
        }

        // Apply configured output guardrails to all outbound post/comment content.
        for (const post of inputData.socialPost) {
          for (const item of post.postsAndComments) {
            item.content = await guardOutbound(
              this._guardrailService,
              item.content,
              { userId, orgId: organizationId }
            );
          }
        }

        const integrations = {} as Record<string, Integration>;
        for (const platform of inputData.socialPost) {
          const resolved = await this._integrationService.getIntegrationById(
            organizationId,
            platform.integrationId
          );
          integrations[platform.integrationId] = resolved;

          // 4.2d — refuse to schedule/publish onto a channel that is disabled or
          // needs reauthentication; the publish would fail. Drafts are allowed
          // (the user may reconnect before promoting).
          if (
            resolved &&
            platform.type !== 'draft' &&
            (resolved.disabled || resolved.refreshNeeded)
          ) {
            return {
              errors: `${resolved.name}: This channel is disconnected or needs reauthentication. Reconnect it before scheduling.`,
            };
          }

          // Same server-side validation as the dashboard / public API
          // (settings DTO + media checkValidity + empty / too-long content).
          const settings = platform.settings.reduce(
            (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
              ...acc,
              [s.key]: s.value,
            }),
            {} as AllProvidersSettings
          );

          const [validation] = await this._postsService.validatePosts(
            organizationId,
            [
              {
                integration: { id: platform.integrationId },
                settings,
                value: platform.postsAndComments.map((p: any) => ({
                  content: p.content,
                  image: (p.attachments || []).map((path: string) => ({
                    path,
                  })),
                })),
              },
            ]
          );

          if (validation.emptyContent) {
            return {
              errors: `${validation.name}: Your post should have at least one character or one image.`,
            };
          }

          if (platform.type !== 'draft') {
            if (!validation.valid) {
              return {
                errors: `${validation.name}: ${
                  validation.settingsError || 'Please fix your settings'
                }, please fix it, and try integrationSchedulePostTool again.`,
              };
            }

            if (validation.errors !== true) {
              return {
                errors: `${validation.name}: ${validation.errors}, please fix it, and try integrationSchedulePostTool again.`,
              };
            }

            if (validation.tooLong) {
              return {
                errors: `${validation.name}: The maximum characters is ${validation.maximumCharacters}, please fix it, and try integrationSchedulePostTool again.`,
              };
            }
          }
        }

        for (const post of inputData.socialPost) {
          const integration = integrations[post.integrationId];

          if (!integration) {
            throw new Error('Integration not found');
          }

          const output = await this._postsService.createPost(organizationId, {
            date: post.date,
            type: post.type as 'draft' | 'schedule' | 'now',
            shortLink: post.shortLink,
            tags: [],
            posts: [
              {
                integration,
                group: makeId(10),
                settings: post.settings.reduce(
                  (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
                    ...acc,
                    [s.key]: s.value,
                  }),
                  {
                    __type: integration.providerIdentifier,
                  } as AllProvidersSettings
                ),
                value: post.postsAndComments.map((p: any) => ({
                  content: p.content,
                  id: makeId(10),
                  delay: 0,
                  image: p.attachments.map((p: any) => ({
                    id: makeId(10),
                    path: p,
                  })),
                })),
              },
            ],
          }, 'MCP');
          finalOutput.push(...output);
        }

        return {
          output: finalOutput,
        };
      },
    });
  }
}
