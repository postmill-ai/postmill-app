import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import {
  parseOrg,
  parseUser,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class CampaignUpdateTool implements AgentToolInterface {
  constructor(private _campaignsService: CampaignsService) {}
  name = 'campaignUpdate';

  run() {
    return createTool({
      id: this.name,
      description: `Update an existing campaign's metadata, dates, goals, or archive state. Requires write scope.`,
      inputSchema: z.object({
        id: z.string().describe('Campaign id'),
        name: z.string().min(1).optional().describe('Campaign name'),
        description: z.string().optional().describe('Optional description'),
        color: z.string().optional().describe('Optional color (hex)'),
        startDate: z
          .string()
          .datetime()
          .optional()
          .describe('Optional start date (ISO 8601)'),
        endDate: z
          .string()
          .datetime()
          .optional()
          .describe('Optional end date (ISO 8601)'),
        archived: z.boolean().optional().describe('Archive the campaign'),
        utmEnabled: z
          .boolean()
          .optional()
          .describe('Auto-append UTM params to links in campaign posts'),
        client: z.string().optional().describe('Optional client name'),
        project: z.string().optional().describe('Optional project name'),
        tags: z.array(z.string()).optional().describe('Optional tags'),
        goals: z
          .array(z.object({ metric: z.string(), target: z.number() }))
          .optional()
          .describe('Optional goals as metric/target pairs'),
      }),
      outputSchema: z.object({
        id: z.string(),
        name: z.string(),
      }),
      mcp: {
        annotations: {
          title: 'Update Campaign',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireWrite(ctx);
        const org = parseOrg(ctx);
        parseUser(ctx);

        const { id, ...changes } = inputData;

        const result = await this._campaignsService.update(id, org.id, {
          ...changes,
          startDate: changes.startDate
            ? new Date(changes.startDate)
            : undefined,
          endDate: changes.endDate ? new Date(changes.endDate) : undefined,
        });

        return { id: result.id, name: result.name };
      },
    });
  }
}
