import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { z } from 'zod';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class ListMediaProvidersTool implements AgentToolInterface {
  constructor(
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
  ) {}
  name = 'listMediaProviders';

  run() {
    return createTool({
      id: 'listMediaProviders',
      description:
        'List the AI media providers configured and enabled for this organization (Runway, Luma, HeyGen, etc.). Returns identifier, display name, and supported capabilities.',
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'List Media Providers',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.array(
        z.object({
          identifier: z.string(),
          name: z.string(),
          capabilities: z.record(z.boolean()),
        })
      ),
      execute: async (_inputData, context) => {
        checkAuth(_inputData, context);
        requireRead(context);
        const org = parseOrg(context);
        const providers = await this._orgMediaProviderSettings.getProviders(org.id);
        return providers
          .filter((p) => p.isConfigured && p.enabled)
          .map((p) => ({
            identifier: p.identifier,
            name: p.name,
            capabilities: p.capabilities,
          }));
      },
    });
  }
}
