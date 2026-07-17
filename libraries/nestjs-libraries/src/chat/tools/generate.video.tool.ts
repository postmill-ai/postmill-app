import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { DefaultsResolutionService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-resolution.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { parseOrg, requireWrite } from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class GenerateVideoTool implements AgentToolInterface {
  constructor(
    private _aiDefaults: AiDefaultsService,
    private _defaultsResolution: DefaultsResolutionService,
  ) {}
  name = 'generateVideoTool';

  run() {
    return createTool({
      id: 'generateVideoTool',
      mcp: {
        annotations: {
          title: 'Generate Video',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `Generate video to use in a post.
                    In case the user specified a platform that requires attachment and attachment was not provided,
                    ask if they want to generate a picture or a video.
                    Available video categories are derived from the org's media defaults.
      `,
      inputSchema: z.object({
        prompt: z.string().describe('Prompt describing the video to generate'),
        imageUrl: z.string().optional().describe('Optional source image URL for image-to-video'),
      }),
      outputSchema: z.object({
        id: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        requireWrite(context as any);
        const org = parseOrg(context as any);
        const artifact = inputData.imageUrl
          ? await this._aiDefaults.imageToVideo(org.id, inputData.prompt, inputData.imageUrl)
          : await this._aiDefaults.textToVideo(org.id, inputData.prompt);
        return { id: artifact };
      },
    });
  }
}
