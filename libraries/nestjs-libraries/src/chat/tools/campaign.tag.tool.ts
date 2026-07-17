import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { CampaignTagService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-item.service';
import {
  parseOrg,
  parseUser,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

const ENTITY_TYPE_SLUGS = [
  'post',
  'channel',
  'vpn',
  'llm',
  'brand',
  'storage',
  'file',
  'set',
  'signature',
] as const;

@Injectable()
export class CampaignTagTool implements AgentToolInterface {
  constructor(private _campaignTagService: CampaignTagService) {}
  name = 'campaignTag';

  run() {
    return createTool({
      id: this.name,
      description: `Tag or untag an entity on a campaign. Entities can be posts, channels, VPN configs, LLM configs, brand profiles, storage configs, files, sets, or signatures. Requires write scope.`,
      inputSchema: z.object({
        campaignId: z.string().describe('Campaign id'),
        action: z.enum(['tag', 'untag']).describe('Whether to tag or untag'),
        entityType: z
          .enum(ENTITY_TYPE_SLUGS)
          .describe('Type of entity to tag/untag'),
        entityId: z.string().describe('Entity id'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
      }),
      mcp: {
        annotations: {
          title: 'Tag Campaign Item',
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

        if (inputData.action === 'tag') {
          return this._campaignTagService.tagItem(
            org.id,
            inputData.campaignId,
            user.id,
            inputData.entityType,
            inputData.entityId
          );
        }

        return this._campaignTagService.untagItem(
          org.id,
          inputData.campaignId,
          user.id,
          inputData.entityType,
          inputData.entityId
        );
      },
    });
  }
}
