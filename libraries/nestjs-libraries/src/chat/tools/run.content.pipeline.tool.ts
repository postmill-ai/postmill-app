import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { ContentPipelineConductorService } from '@gitroom/nestjs-libraries/chat/content-pipeline/content-pipeline-conductor.service';
import {
  parseOrg,
  parseUser,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class RunContentPipelineTool implements AgentToolInterface {
  name = 'runContentPipeline';

  constructor(
    private readonly _conductor: ContentPipelineConductorService
  ) {}

  run() {
    return createTool({
      id: 'runContentPipeline',
      description:
        'Generate on-brand, per-platform social copy through a staged ' +
        'brand-critiqued pipeline. Best for launch posts, campaign copy, ' +
        'or any multi-channel content that must match brand voice.',
      inputSchema: z.object({
        brief: z
          .string()
          .describe('The content brief: topic, goal, and key messages'),
        platforms: z
          .array(z.string())
          .optional()
          .describe(
            'Target platforms (e.g. x, linkedin, instagram). Defaults to x + linkedin.'
          ),
        tone: z
          .string()
          .optional()
          .describe('Desired tone override (e.g. professional, playful)'),
      }),
      outputSchema: z.object({
        content: z
          .array(z.string())
          .describe('Flat list of finalized copy variants'),
        perPlatform: z
          .record(z.string())
          .describe('Map of platform id to finalized copy'),
      }),
      mcp: {
        annotations: {
          title: 'Run Content Pipeline',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireRead(ctx);
        const org = parseOrg(ctx);
        const user = parseUser(ctx);
        const result = await this._conductor.generate(org.id, user.id, {
          brief: inputData.brief,
          platforms: inputData.platforms,
          tone: inputData.tone,
        });
        return {
          content: result.content,
          perPlatform: result.perPlatform,
        };
      },
    });
  }
}
