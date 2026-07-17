import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import {
  parseOrg,
  parseUser,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

/**
 * Required scope: none for normal UI usage; MCP callers need `mcp:read`.
 * This is a read-only/idempotent tool.
 */
@Injectable()
export class CommentsInboxTool implements AgentToolInterface {
  constructor(private _socialCommentsService: SocialCommentsService) {}
  name = 'commentsInbox';

  run() {
    return createTool({
      id: 'commentsInbox',
      description:
        'List synced social comments from the unified comments inbox. Optionally filter by status, assignee, campaign, channel/integration, or unread-only. Returns a capped list plus a cursor for pagination.',
      inputSchema: z.object({
        status: z
          .enum(['needs_reply', 'handled', 'ignored'])
          .optional()
          .describe('Filter by comment workflow status'),
        assigneeId: z
          .string()
          .optional()
          .describe('Filter by assigned user id'),
        cursor: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous call'),
        unreadOnly: z
          .boolean()
          .optional()
          .describe('Only return comments that have not been marked as handled'),
        campaignIds: z
          .array(z.string())
          .optional()
          .describe('Filter by one or more campaign ids'),
        integrationIds: z
          .array(z.string())
          .optional()
          .describe('Filter by one or more channel/integration ids'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max comments to return this page (1-50, default 25)'),
      }),
      outputSchema: z.object({
        comments: z.array(
          z.object({
            id: z.string(),
            postId: z.string(),
            integrationId: z.string(),
            platformCommentId: z.string(),
            parentPlatformCommentId: z.string().nullable(),
            authorName: z.string(),
            authorUsername: z.string().nullable(),
            authorPicture: z.string().nullable(),
            content: z.string(),
            likeCount: z.number(),
            replyCount: z.number(),
            likedByMe: z.boolean(),
            isOwn: z.boolean(),
            status: z.string().nullable(),
            assigneeId: z.string().nullable(),
            platformCreatedAt: z.string(),
            post: z.object({
              id: z.string(),
              content: z.string().nullable(),
              publishDate: z.string().nullable(),
              integration: z.object({
                name: z.string().nullable(),
                providerIdentifier: z.string().nullable(),
                picture: z.string().nullable(),
              }),
            }),
          })
        ),
        nextCursor: z.string().optional(),
      }),
      mcp: {
        annotations: {
          title: 'List Comments Inbox',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireRead(ctx);
        const org = parseOrg(ctx);
        const user = parseUser(ctx);

        // Thread limit into the repo so nextCursor is derived from the last item
        // we actually return (slicing here would skip items 26-50 of every page).
        const filters = {
          status: inputData.status,
          assigneeId: inputData.assigneeId,
          cursor: inputData.cursor,
          unreadOnly: inputData.unreadOnly,
          campaignIds: inputData.campaignIds,
          integrationIds: inputData.integrationIds,
          limit: inputData.limit ?? 25,
        };

        const { comments, nextCursor } =
          await this._socialCommentsService.getInbox(org.id, user.id, filters);

        return {
          comments: comments.map((comment: any) => ({
            id: comment.id,
            postId: comment.postId,
            integrationId: comment.integrationId,
            platformCommentId: comment.platformCommentId,
            parentPlatformCommentId: comment.parentPlatformCommentId ?? null,
            authorName: comment.authorName,
            authorUsername: comment.authorUsername ?? null,
            authorPicture: comment.authorPicture ?? null,
            // Cap very long comments to keep token usage low.
            content:
              comment.content && comment.content.length > 2000
                ? `${comment.content.slice(0, 2000)}…`
                : comment.content ?? '',
            likeCount: comment.likeCount ?? 0,
            replyCount: comment.replyCount ?? 0,
            likedByMe: comment.likedByMe ?? false,
            isOwn: comment.isOwn ?? false,
            status: comment.status ?? null,
            assigneeId: comment.assigneeId ?? null,
            platformCreatedAt: comment.platformCreatedAt?.toISOString?.()
              ? comment.platformCreatedAt.toISOString()
              : String(comment.platformCreatedAt),
            post: {
              id: comment.post?.id,
              content:
                comment.post?.content && comment.post.content.length > 500
                  ? `${comment.post.content.slice(0, 500)}…`
                  : comment.post?.content ?? null,
              publishDate: comment.post?.publishDate?.toISOString?.()
                ? comment.post.publishDate.toISOString()
                : comment.post?.publishDate
                  ? String(comment.post.publishDate)
                  : null,
              integration: {
                name: comment.post?.integration?.name ?? null,
                providerIdentifier:
                  comment.post?.integration?.providerIdentifier ?? null,
                picture: comment.post?.integration?.picture ?? null,
              },
            },
          })),
          nextCursor,
        };
      },
    });
  }
}
