import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from './tool.helpers';

@Injectable()
export class AnalyticsRecommendationsTool implements AgentToolInterface {
  constructor(private _analyticsService: AnalyticsService) {}
  name = 'recommendations';

  run() {
    return createTool({
      id: 'recommendations',
      description:
        'Returns prioritized analytics-based recommendations for the organization. ' +
        'Use this when the user asks "what should I do next", "give me recommendations", or "how can I improve".',
      mcp: {
        annotations: {
          title: 'Analytics Recommendations',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({}),
      outputSchema: z.object({
        recommendations: z.array(
          z.object({
            type: z.string(),
            title: z.string(),
            description: z.string(),
            action: z.string(),
            link: z.string(),
            priority: z.number(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        const result = await this._analyticsService.getRecommendations(org as any);
        return result;
      },
    });
  }
}
