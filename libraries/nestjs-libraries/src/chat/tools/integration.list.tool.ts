import {
  AgentToolInterface,
} from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class IntegrationListTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationList';

  run() {
    return createTool({
      id: 'integrationList',
      description: `This tool list available integrations to schedule posts to. Optionally pass a group id (from the groupList tool) to only list integrations belonging to that group`,
      inputSchema: z.object({
        group: z
          .string()
          .optional()
          .describe(
            'Optional group (customer) id from the groupList tool to filter the integrations'
          ),
      }),
      mcp: {
        annotations: {
          title: 'List Integrations',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            picture: z.string(),
            platform: z.string(),
            // Without these, @mastra/core `validateToolOutput` silently STRIPS the
            // fields the `.map` emits (and the group `.filter` relies on `customer`).
            disabled: z.boolean().optional(),
            display: z.string().optional(),
            type: z.string().optional(),
            customer: z
              .object({ id: z.string(), name: z.string() })
              .optional(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context as any);
        const organizationId = parseOrg(context as any).id;

        return {
          output: (
            await this._integrationService.getIntegrationsList(organizationId)
          )
            .filter((p) => !inputData.group || p.customer?.id === inputData.group)
            .map((p) => ({
              name: p.name,
              id: p.id,
              disabled: p.disabled,
              picture: p.picture || '/no-picture.jpg',
              platform: p.providerIdentifier,
              display: p.profile,
              type: p.type,
              customer: p.customer
                ? {
                    id: p.customer.id,
                    name: p.customer.name,
                  }
                : undefined,
            })),
        };
      },
    });
  }
}
