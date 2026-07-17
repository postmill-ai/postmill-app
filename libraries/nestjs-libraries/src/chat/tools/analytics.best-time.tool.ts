import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from './tool.helpers';

@Injectable()
export class AnalyticsBestTimeTool implements AgentToolInterface {
  constructor(private _analyticsService: AnalyticsService) {}
  name = 'bestTime';

  run() {
    return createTool({
      id: 'bestTime',
      description:
        'Returns the best day/hour slots to post based on historical engagement. ' +
        'Use this when the user asks "when should I post", "best time to post", or "what time gets the most engagement".',
      mcp: {
        annotations: {
          title: 'Best Time to Post',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        integrationIds: z
          .array(z.string())
          .optional()
          .describe('Optional channel/integration ids to restrict the analysis'),
      }),
      outputSchema: z.object({
        bestSlots: z.array(
          z.object({
            day: z.number().describe('Day of week (0 = Sunday, 6 = Saturday)'),
            hour: z.number().describe('Hour of day (0-23)'),
            avgEngagement: z.number(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        const result = await this._analyticsService.getBestTimeData(
          org.id,
          inputData.integrationIds
        );

        return { bestSlots: result.bestSlots };
      },
    });
  }
}
