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
export class CampaignCreateTool implements AgentToolInterface {
  constructor(private _campaignsService: CampaignsService) {}
  name = 'campaignCreate';

  run() {
    return createTool({
      id: this.name,
      description: `Create a new campaign folder. Campaigns group posts, channels, files, and planning notes. Requires write scope.`,
      inputSchema: z.object({
        name: z.string().min(1).describe('Campaign name'),
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
          title: 'Create Campaign',
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
        const user = parseUser(ctx);

        const result = await this._campaignsService.create({
          organizationId: org.id,
          createdById: user.id,
          name: inputData.name,
          description: inputData.description,
          color: inputData.color,
          startDate: inputData.startDate
            ? new Date(inputData.startDate)
            : undefined,
          endDate: inputData.endDate ? new Date(inputData.endDate) : undefined,
          utmEnabled: inputData.utmEnabled,
          client: inputData.client,
          project: inputData.project,
          tags: inputData.tags,
          goals: inputData.goals,
        });

        return { id: result.id, name: result.name };
      },
    });
  }
}
