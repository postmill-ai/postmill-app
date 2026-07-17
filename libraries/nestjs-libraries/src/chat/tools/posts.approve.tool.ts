import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, BadRequestException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  parseOrg,
  parseUser,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class PostsApproveTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'approveDraft';

  run() {
    return createTool({
      id: 'approveDraft',
      description: `Approve a draft post so it can be scheduled/published. Requires mcp:posts:write scope.`,
      inputSchema: z.object({
        postId: z.string().describe('The draft post id'),
      }),
      outputSchema: z
        .object({
          id: z.string(),
          approvalStatus: z.string(),
        })
        .or(z.object({ error: z.string() })),
      mcp: {
        annotations: {
          title: 'Approve Draft',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const toolContext = context as any;
        requireWrite(toolContext);
        const org = parseOrg(toolContext);
        const user = parseUser(toolContext);
        try {
          return await this._postsService.approveDraft(
            org.id,
            inputData.postId,
            user.id
          );
        } catch (err) {
          if (err instanceof BadRequestException) {
            return { error: err.message };
          }
          throw err;
        }
      },
    });
  }
}
