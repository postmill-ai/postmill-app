import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  parseOrg,
  requireWrite,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class PostsDeleteTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'deletePost';

  run() {
    return createTool({
      id: 'deletePost',
      description: `Delete a cross-channel post group by its group id. This is destructive and always requires human-in-the-loop confirmation before invoking. Requires mcp:posts:write scope.`,
      inputSchema: z.object({
        group: z.string().describe('The post group id (from listPosts)'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        group: z.string(),
      }),
      mcp: {
        annotations: {
          title: 'Delete Post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const toolContext = context as any;
        requireWrite(toolContext);
        const org = parseOrg(toolContext);
        await this._postsService.deletePost(org.id, inputData.group);
        return {
          success: true,
          group: inputData.group,
        };
      },
    });
  }
}
