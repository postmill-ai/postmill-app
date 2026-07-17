import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from './tool.helpers';

@Injectable()
export class AnalyticsPostTool implements AgentToolInterface {
  constructor(private _analyticsService: AnalyticsService) {}
  name = 'analyticsPost';

  run() {
    return createTool({
      id: 'analyticsPost',
      description:
        'Returns analytics detail for a specific post, including daily metric series. ' +
        'Use this when the user asks "how did this post perform", "post analytics", or "stats for post X".',
      mcp: {
        annotations: {
          title: 'Post Analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        postId: z.string().describe('The post id to look up'),
        date: z
          .string()
          .optional()
          .describe(
            'Optional number of days to look back (e.g. "7", "30"). Defaults to 30.'
          ),
      }),
      outputSchema: z
        .object({
          postId: z.string(),
          content: z.string(),
          integration: z.object({
            id: z.string(),
            name: z.string(),
            identifier: z.string(),
            picture: z.string().nullable(),
          }),
          publishedAt: z.string(),
          metrics: z.record(
            z.string(),
            z.array(
              z.object({
                date: z.string(),
                value: z.number(),
              })
            )
          ),
        })
        .or(
          z.object({
            error: z.string(),
          })
        ),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        try {
          const detail = await this._analyticsService.getPostDetail(
            org as any,
            inputData.postId,
            inputData.date
          );
          // Cap each daily metric series to the most recent points so a large
          // lookback window can't blow the agent's context (token budget, risk #6).
          const MAX_POINTS = 30;
          if (detail?.metrics && typeof detail.metrics === 'object') {
            for (const key of Object.keys(detail.metrics)) {
              const series = (detail.metrics as Record<string, unknown[]>)[key];
              if (Array.isArray(series) && series.length > MAX_POINTS) {
                (detail.metrics as Record<string, unknown[]>)[key] =
                  series.slice(-MAX_POINTS);
              }
            }
          }
          return detail;
        } catch (err) {
          if (err instanceof NotFoundException) {
            return { error: 'Post not found' };
          }
          throw err;
        }
      },
    });
  }
}
