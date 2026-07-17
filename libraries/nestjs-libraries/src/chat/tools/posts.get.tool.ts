import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  parseOrg,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';
import { htmlToText } from '@gitroom/helpers/utils/html.to.text';

const PREVIEW_LENGTH = 200;

@Injectable()
export class PostsGetTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'getPost';

  private summarizePost(post: any) {
    return {
      id: post.id,
      contentPreview:
        htmlToText(post.content || '').slice(0, PREVIEW_LENGTH) +
        (htmlToText(post.content || '').length > PREVIEW_LENGTH ? '…' : ''),
      state: post.state,
      publishDate: post.publishDate,
      imageCount: Array.isArray(post.image) ? post.image.length : 0,
    };
  }

  run() {
    return createTool({
      id: 'getPost',
      description: `Get the full details of a single post group, including its thread and a settings summary.`,
      inputSchema: z.object({
        id: z.string().describe('The post id (any post in the group)'),
      }),
      outputSchema: z.object({
        group: z.string().optional(),
        integrationId: z.string().optional(),
        integrationPicture: z.string().optional(),
        settings: z.record(z.any()).optional(),
        posts: z
          .array(
            z.object({
              id: z.string(),
              contentPreview: z.string(),
              state: z.string().optional(),
              publishDate: z.any().optional(),
              imageCount: z.number(),
            })
          )
          .optional(),
        error: z.string().optional(),
      }),
      mcp: {
        annotations: {
          title: 'Get Post',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const toolContext = context as any;
        requireRead(toolContext);
        const org = parseOrg(toolContext);

        // An unknown/foreign id yields an empty org-scoped result; the service
        // dereferences posts[0] on that empty array and throws a TypeError.
        // Guard here so the model gets a clean not-found instead of a raw error.
        let post: Awaited<ReturnType<PostsService['getPost']>>;
        try {
          post = await this._postsService.getPost(org.id, inputData.id);
        } catch {
          return { error: 'Post not found' };
        }
        if (!post?.posts?.length) {
          return { error: 'Post not found' };
        }

        return {
          group: post.group,
          integrationId: post.integration,
          integrationPicture: post.integrationPicture,
          settings: post.settings ?? {},
          posts: (post.posts || []).map((p) => this.summarizePost(p)),
        };
      },
    });
  }
}
