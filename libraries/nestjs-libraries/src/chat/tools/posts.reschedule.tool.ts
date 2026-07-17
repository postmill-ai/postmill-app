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
export class PostsRescheduleTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'reschedulePost';

  run() {
    return createTool({
      id: 'reschedulePost',
      description: `Reschedule a post to a new publish date. Re-queues the post and restarts the workflow. Requires mcp:posts:write scope.`,
      inputSchema: z.object({
        id: z.string().describe('The post id'),
        date: z.string().describe('New publish date in ISO 8601 format'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        id: z.string(),
        date: z.string(),
      }),
      mcp: {
        annotations: {
          title: 'Reschedule Post',
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

        // 4.2a — load the post first (org-scoped). Reject an unknown/foreign id
        // (would 500 in changeDate) and refuse to re-queue an already-PUBLISHED
        // post (would republish it).
        const post = await this._postsService.getPostById(inputData.id, org.id);
        if (!post) {
          throw new Error('Post not found');
        }
        if (post.state === 'PUBLISHED') {
          throw new Error('Cannot reschedule a post that has already been published');
        }

        await this._postsService.changeDate(
          org.id,
          inputData.id,
          inputData.date,
          'schedule'
        );
        return {
          success: true,
          id: inputData.id,
          date: inputData.date,
        };
      },
    });
  }
}
