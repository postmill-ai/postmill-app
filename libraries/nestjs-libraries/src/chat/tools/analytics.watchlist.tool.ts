import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { WatchlistService } from '@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.service';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class AnalyticsWatchlistTool implements AgentToolInterface {
  constructor(private _watchlistService: WatchlistService) {}
  name = 'watchlist';

  run() {
    return createTool({
      id: 'watchlist',
      description:
        'List the accounts the organization is watching (competitors or benchmarks). ' +
        'Returns the latest captured public follower/subscriber metric for each account.',
      mcp: {
        annotations: {
          title: 'Competitor Watchlist',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        enabledOnly: z
          .boolean()
          .optional()
          .describe('If true, only return enabled watchlist accounts'),
      }),
      outputSchema: z.object({
        output: z.array(
          z.object({
            provider: z.string(),
            handle: z.string(),
            displayName: z.string().nullable(),
            metric: z.string().nullable(),
            value: z.number().nullable(),
            capturedAt: z.string().nullable(),
            lastError: z.string().nullable(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const org = parseOrg(context as any);

        let accounts = await this._watchlistService.list(org.id);

        if (inputData.enabledOnly) {
          accounts = accounts.filter((a) => a.enabled);
        }

        return {
          output: accounts.map((account) => {
            const latest = account.metrics[0];
            return {
              provider: account.provider,
              handle: account.handle,
              displayName: account.displayName ?? null,
              metric: latest?.metric ?? null,
              value: latest?.value ?? null,
              capturedAt: latest?.capturedAt?.toISOString() ?? null,
              lastError: account.lastError ?? null,
            };
          }),
        };
      },
    });
  }
}
