import { AgentToolInterface } from '@postmill-ai/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@postmill-ai/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { OrgMediaProviderSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { MediaDefaultsService } from '@postmill-ai/nestjs-libraries/ai/defaults/media-defaults.service';
import { z } from 'zod';
import { parseOrg, requireRead } from '@postmill-ai/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class ListMediaProvidersTool implements AgentToolInterface {
  constructor(
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
    private _mediaDefaults: MediaDefaultsService,
  ) {}
  name = 'listMediaProviders';

  run() {
    return createTool({
      id: 'listMediaProviders',
      description:
        'List the AI media providers configured and enabled for this organization (Runway, Luma, HeyGen, etc.). Returns identifier, display name, supported capabilities, and the organization\'s configured default model per media category (defaults) — prefer the default when the user did not name a model.',
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
          capabilities: z.record(z.string(), z.boolean()),
          defaults: z.array(
            z.object({
              category: z.string(),
              model: z.string(),
            })
          ),
        })
      ),
      execute: async (_inputData, context) => {
        checkAuth(_inputData, context);
        requireRead(context);
        const org = parseOrg(context);
        const providers = await this._orgMediaProviderSettings.getProviders(org.id);
        const usable = providers.filter((p) => p.isConfigured && p.enabled);
        if (usable.length === 0) return [];

        // Ground the agent in the org's resolved defaults so it doesn't guess a
        // model off the provider's raw live catalog (e.g. a router alias).
        const { categories } = await this._mediaDefaults
          .getMediaDefaults(org.id)
          .catch(() => ({ categories: [] as any[] }));
        return usable.map((p) => ({
          identifier: p.identifier,
          name: p.name,
          capabilities: p.capabilities,
          defaults: categories
            .filter((c: any) => c.providerId === p.identifier && c.model)
            .map((c: any) => ({ category: c.category, model: c.model })),
        }));
      },
    });
  }
}
