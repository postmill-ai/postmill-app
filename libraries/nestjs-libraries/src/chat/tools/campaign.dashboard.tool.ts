import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import {
  parseOrg,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

const CHANNEL_CAP = 20;
const UPCOMING_CAP = 5;

@Injectable()
export class CampaignDashboardTool implements AgentToolInterface {
  constructor(private _campaignsService: CampaignsService) {}
  name = 'campaignDashboard';

  run() {
    return createTool({
      id: this.name,
      description: `Return a summarized campaign dashboard: metadata, engagement KPIs, post state counts, goals, channels, and upcoming scheduled posts. Heavy arrays are dropped to keep token usage low.`,
      inputSchema: z.object({
        id: z.string().describe('Campaign id'),
      }),
      outputSchema: z
        .object({
          id: z.string(),
          name: z.string(),
          color: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
          archived: z.boolean(),
          utmEnabled: z.boolean(),
          client: z.string().nullable().optional(),
          project: z.string().nullable().optional(),
          tags: z.array(z.string()).nullable().optional(),
          engagement: z.object({
            totalViews: z.number(),
            totalLikes: z.number(),
            totalComments: z.number(),
            avgViews: z.number(),
            avgLikes: z.number(),
            avgComments: z.number(),
            topPost: z
              .object({
                id: z.string(),
                title: z.string(),
                lastViews: z.number().nullable().optional(),
                lastLikes: z.number().nullable().optional(),
                lastComments: z.number().nullable().optional(),
                integration: z.string(),
              })
              .nullable(),
          }),
          stateCounts: z.record(z.string(), z.number()),
          clickTotal: z.number(),
          goals: z.array(z.any()).nullable().optional(),
          channels: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              providerIdentifier: z.string(),
              postCount: z.number(),
            })
          ),
          upcoming: z.array(
            z.object({
              id: z.string(),
              title: z.string().nullable().optional(),
              publishDate: z.string(),
              integrationName: z.string(),
            })
          ),
        })
        .or(z.object({ error: z.string() })),
      mcp: {
        annotations: {
          title: 'Campaign Dashboard',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireRead(ctx);
        const org = parseOrg(ctx);

        try {
          const dashboard = await this._campaignsService.getDashboard(
            inputData.id,
            org.id
          );
          const { campaign, engagement, stateCounts, goals, channels, upcoming, clickTotal } =
            dashboard;

          return {
            id: campaign.id,
            name: campaign.name,
            color: campaign.color,
            description: campaign.description,
            startDate: campaign.startDate?.toISOString() ?? null,
            endDate: campaign.endDate?.toISOString() ?? null,
            archived: campaign.archived,
            utmEnabled: campaign.utmEnabled,
            client: campaign.client,
            project: campaign.project,
            tags: Array.isArray(campaign.tags) ? campaign.tags : null,
            engagement: {
              totalViews: engagement.totalViews,
              totalLikes: engagement.totalLikes,
              totalComments: engagement.totalComments,
              avgViews: engagement.avgViews,
              avgLikes: engagement.avgLikes,
              avgComments: engagement.avgComments,
              topPost: engagement.topPost
                ? {
                    id: engagement.topPost.id,
                    title: engagement.topPost.title,
                    lastViews: engagement.topPost.lastViews,
                    lastLikes: engagement.topPost.lastLikes,
                    lastComments: engagement.topPost.lastComments,
                    integration: engagement.topPost.integration,
                  }
                : null,
            },
            stateCounts,
            clickTotal,
            goals: Array.isArray(goals) ? goals : null,
            channels: channels.slice(0, CHANNEL_CAP).map((c) => ({
              id: c.id,
              name: c.name,
              providerIdentifier: c.providerIdentifier,
              postCount: c.postCount,
            })),
            upcoming: upcoming.slice(0, UPCOMING_CAP).map((p) => ({
              id: p.id,
              title: p.title,
              publishDate: p.publishDate.toISOString(),
              integrationName: p.integration.name,
            })),
          };
        } catch (err) {
          if (err instanceof NotFoundException) {
            return { error: err.message };
          }
          throw err;
        }
      },
    });
  }
}
