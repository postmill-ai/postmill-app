import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaStudioService } from '@gitroom/nestjs-libraries/media/studio/media-studio.service';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';
import { z } from 'zod';
import {
  parseOrg,
  parseUser,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class MediaStudioGenerateTool implements AgentToolInterface {
  constructor(
    private _mediaStudio: MediaStudioService,
    private _orgMediaProviderSettings: OrgMediaProviderSettingsService,
  ) {}
  name = 'mediaStudioGenerate';

  run() {
    return createTool({
      id: 'mediaStudioGenerate',
      description:
        'Generate media (image, video, or audio) through a specific configured AI media provider/model. Returns a jobId; poll mediaJobStatus until the artifact is ready.',
      inputSchema: z.object({
        provider: z
          .string()
          .describe('The provider identifier, e.g. "runway", "luma", "openai", "elevenlabs"'),
        operation: z
          .enum(['image', 'video', 'audio'])
          .describe('The media operation to perform'),
        model: z
          .string()
          .optional()
          .describe('Optional model id; provider default is used when omitted'),
        input: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .describe('Provider-native generation parameters (e.g. prompt, resolution, duration)'),
        mediaInputs: z
          .record(z.string())
          .optional()
          .describe('Map of provider media-field names to /files fileIds (resolved to public URLs)'),
        folderId: z
          .string()
          .optional()
          .describe('Optional destination folder id in the organization file library'),
      }),
      mcp: {
        annotations: {
          title: 'Generate Media in Studio',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      outputSchema: z.union([
        z.object({
          jobId: z.string(),
          status: z.literal('submitted'),
          note: z.string(),
        }),
        z.object({
          error: z.string(),
        }),
        z.object({
          needsConfirmation: z.literal(true),
          draft: z.object({
            provider: z.string(),
            operation: z.enum(['image', 'video', 'audio']),
            model: z.string().optional(),
            input: z.record(z.union([z.string(), z.number(), z.boolean()])),
            mediaInputs: z.record(z.string()).optional(),
            folderId: z.string().optional(),
          }),
        }),
      ]),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireWrite(context);
        const org = parseOrg(context);
        const user = parseUser(context);

        const config = await this._orgMediaProviderSettings.getConfigForProvider(
          org.id,
          inputData.provider
        );
        if (!config || Object.keys(config.credentials).length === 0) {
          return {
            error: `${inputData.provider} is not configured. Add credentials in Settings → Media.`,
          } as any;
        }

        // Structural, non-forgeable human-in-the-loop gate. In a browser/agent-UI
        // session (`ui === 'true'`) the tool NEVER starts a paid job — it always
        // returns a draft for human approval, which the frontend confirm card
        // dispatches out-of-band via the REST studio-generate route (NOT by
        // re-invoking this tool). There is deliberately no model-settable
        // `confirmed` bypass: the acting LLM (a delegated specialist, or one steered
        // by injected instructions) controls the tool args, so a boolean it can set
        // is not proof of human intent. MCP/A2A/headless (`ui !== 'true'`) execute
        // directly under their granted scopes.
        if ((context as any).requestContext?.get('ui') === 'true') {
          return {
            needsConfirmation: true as const,
            draft: {
              provider: inputData.provider,
              operation: inputData.operation,
              model: inputData.model,
              input: inputData.input,
              mediaInputs: inputData.mediaInputs,
              folderId: inputData.folderId,
            },
          } as any;
        }

        const { jobId } = await this._mediaStudio.generate(org.id, user.id, inputData.provider, {
          operation: inputData.operation,
          model: inputData.model,
          input: inputData.input,
          mediaInputs: inputData.mediaInputs,
          folderId: inputData.folderId,
        });

        return {
          jobId,
          status: 'submitted' as const,
          note: 'poll with mediaJobStatus',
        };
      },
    });
  }
}
