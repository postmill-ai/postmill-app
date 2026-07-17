import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from './tool.helpers';

@Injectable()
export class AnalyticsOverviewTool implements AgentToolInterface {
  constructor(private _analyticsService: AnalyticsService) {}
  name = 'analyticsOverview';

  run() {
    return createTool({
      id: 'analyticsOverview',
      description:
        'Returns a high-level analytics overview for the organization over a date range. ' +
        'Use this when the user asks "how are my channels doing", "what are my stats", or "show analytics". ' +
        'Pass integrationIds to filter to specific channels, or omit for all channels.',
      mcp: {
        annotations: {
          title: 'Analytics Overview',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        from: z.string().describe('Start date (ISO 8601, e.g. 2024-01-01)'),
        to: z.string().describe('End date (ISO 8601, e.g. 2024-01-31)'),
        integrationIds: z
          .array(z.string())
          .optional()
          .describe('Optional channel/integration ids to filter the overview'),
        compare: z
          .boolean()
          .optional()
          .describe(
            'When true, includes previous-period totals and percentage change for each KPI'
          ),
      }),
      outputSchema: z.object({
        range: z.object({ from: z.string(), to: z.string() }),
        kpis: z.array(
          z.object({
            metric: z.string(),
            label: z.string(),
            format: z.string(),
            total: z.number(),
            previousTotal: z.number().nullable(),
            percentageChange: z.number().nullable(),
          })
        ),
        byChannel: z.array(
          z.object({
            integrationId: z.string(),
            name: z.string(),
            identifier: z.string(),
            picture: z.string().nullable(),
            kpis: z.array(
              z.object({
                metric: z.string(),
                label: z.string(),
                format: z.string(),
                total: z.number(),
                previousTotal: z.number().nullable(),
                percentageChange: z.number().nullable(),
              })
            ),
          })
        ),
        breakdown: z.object({
          byPlatform: z.array(
            z.object({
              identifier: z.string(),
              value: z.number(),
            })
          ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        const overview = await this._analyticsService.getOverview(
          org as any,
          inputData.from,
          inputData.to,
          inputData.integrationIds ?? [],
          inputData.compare ?? false
        );

        return {
          range: overview.range,
          kpis: overview.kpis.map((kpi) => ({
            metric: kpi.metric,
            label: kpi.label,
            format: kpi.format,
            total: kpi.total,
            previousTotal: kpi.previousTotal,
            percentageChange: kpi.percentageChange,
          })),
          byChannel: overview.byChannel.map((channel) => ({
            integrationId: channel.integrationId,
            name: channel.name,
            identifier: channel.identifier,
            picture: channel.picture,
            kpis: channel.kpis,
          })),
          breakdown: overview.breakdown,
        };
      },
    });
  }
}
