import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  parseOrg,
  parseUser,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';
import {
  expandPostItem,
  expandPostsList,
} from '@gitroom/helpers/utils/posts.list.minify';
import { htmlToText } from '@gitroom/helpers/utils/html.to.text';

const MAX_POSTS = 50;
const PREVIEW_LENGTH = 120;

@Injectable()
export class PostsListTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'listPosts';

  private makePreview(content: string | null | undefined): string {
    const text = htmlToText(content || '');
    return text.length > PREVIEW_LENGTH
      ? text.slice(0, PREVIEW_LENGTH) + '…'
      : text;
  }

  private mapPost(post: any) {
    return {
      id: post.id,
      group: post.group,
      state: post.state,
      publishDate: post.publishDate,
      integration: post.integration
        ? {
            id: post.integration.id,
            name: post.integration.name,
            providerIdentifier: post.integration.providerIdentifier,
          }
        : null,
      campaignId: post.campaignId ?? null,
      contentPreview: this.makePreview(post.content),
    };
  }

  run() {
    return createTool({
      id: 'listPosts',
      description: `List posts for the organization. Use date-range mode (startDate + endDate) to see the calendar view, or filter/list mode (state/page/limit) for paginated posts. Optional campaignId/integrationId filters are applied in-tool after fetching. Results are capped at ${MAX_POSTS}.`,
      inputSchema: z.object({
        startDate: z
          .string()
          .optional()
          .describe('ISO start date for calendar range mode'),
        endDate: z
          .string()
          .optional()
          .describe('ISO end date for calendar range mode'),
        state: z
          .enum(['all', 'scheduled', 'draft', 'published'])
          .optional()
          .describe("Filter by state: 'all' | 'scheduled' | 'draft' | 'published'"),
        customer: z.string().optional().describe('Optional customer/group id'),
        page: z.number().optional().describe('Page number for list mode'),
        limit: z
          .number()
          .optional()
          .describe(`Page size for list mode (max ${MAX_POSTS})`),
        campaignId: z
          .string()
          .optional()
          .describe('Optional in-tool filter by campaign id'),
        integrationId: z
          .string()
          .optional()
          .describe('Optional in-tool filter by integration id'),
      }),
      outputSchema: z.object({
        posts: z.array(
          z.object({
            id: z.string(),
            group: z.string(),
            state: z.string(),
            publishDate: z.any(),
            integration: z
              .object({
                id: z.string(),
                name: z.string(),
                providerIdentifier: z.string(),
              })
              .nullable(),
            campaignId: z.string().nullable(),
            contentPreview: z.string(),
          })
        ),
      }),
      mcp: {
        annotations: {
          title: 'List Posts',
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
        const user = parseUser(toolContext);

        let expandedPosts: any[] = [];
        if (inputData.startDate && inputData.endDate) {
          const result = await this._postsService.getPostsMinified(
            org.id,
            {
              startDate: inputData.startDate,
              endDate: inputData.endDate,
              customer: inputData.customer,
              display: 'list',
              limit: MAX_POSTS,
            } as any,
            user.id
          );
          expandedPosts = (result?.p || []).map(expandPostItem);
        } else {
          const limit = Math.min(inputData.limit || MAX_POSTS, MAX_POSTS);
          const result = await this._postsService.getPostsList(
            org.id,
            {
              page: inputData.page,
              limit,
              customer: inputData.customer,
              state: inputData.state,
            } as any,
            user.id
          );
          const expanded = expandPostsList(result);
          expandedPosts = expanded.posts || [];
        }

        if (inputData.campaignId) {
          expandedPosts = expandedPosts.filter(
            (p) => p.campaignId === inputData.campaignId
          );
        }
        if (inputData.integrationId) {
          expandedPosts = expandedPosts.filter(
            (p) => p.integration?.id === inputData.integrationId
          );
        }

        return {
          posts: expandedPosts
            .slice(0, MAX_POSTS)
            .map((p) => this.mapPost(p)),
        };
      },
    });
  }
}
