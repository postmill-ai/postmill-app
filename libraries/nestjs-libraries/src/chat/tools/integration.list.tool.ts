import {
  AgentToolInterface,
} from '@postmill-ai/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import z from 'zod';
import { checkAuth } from '@postmill-ai/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from '@postmill-ai/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class IntegrationListTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationList';

  run() {
    return createTool({
      id: 'integrationList',
      description: `Lists the connected social channels (accounts) in this workspace with id, platform, name and disabled state, plus the total count. Use it to answer "which channels are connected", "how many channels are configured", and to get the channel id needed before scheduling a post.`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'List Channels',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        // Explicit so small models answer "how many" without counting the list.
        count: z.number(),
        output: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            picture: z.string(),
            platform: z.string(),
            // Without these, @mastra/core `validateToolOutput` silently STRIPS the
            // fields the `.map` emits.
            disabled: z.boolean().optional(),
            display: z.string().optional(),
            type: z.string().optional(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const organizationId = parseOrg(context as any).id;

        const output = (
          await this._integrationService.getIntegrationsList(organizationId)
        ).map((p) => ({
              name: p.name,
              id: p.id,
              disabled: p.disabled,
              picture: p.picture || '/no-picture.jpg',
              platform: p.providerIdentifier,
              display: p.profile,
              type: p.type,
            }));
        return { count: output.length, output };
      },
    });
  }
}
