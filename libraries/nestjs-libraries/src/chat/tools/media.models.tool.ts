import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { MediaStudioService } from '@gitroom/nestjs-libraries/media/studio/media-studio.service';
import { z } from 'zod';
import { parseOrg, requireRead } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class ListMediaModelsTool implements AgentToolInterface {
  constructor(private _mediaStudio: MediaStudioService) {}
  name = 'listMediaModels';

  run() {
    return createTool({
      id: 'listMediaModels',
      description:
        'List available models for a given AI media provider and operation (image, video, or audio). Use listMediaProviders first to discover configured providers.',
      inputSchema: z.object({
        provider: z
          .string()
          .describe('The provider identifier, e.g. "runway", "luma", "openai", "elevenlabs"'),
        operation: z
          .enum(['image', 'video', 'audio'])
          .describe('The media operation to list models for'),
      }),
      mcp: {
        annotations: {
          title: 'List Media Models',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
        })
      ),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireRead(context);
        const org = parseOrg(context);
        return this._mediaStudio.listModels(
          org.id,
          inputData.provider,
          inputData.operation
        );
      },
    });
  }
}
