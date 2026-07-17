import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import {
  parseOrg,
  parseUser,
  requireWrite,
  guardOutbound,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

/**
 * Required scope for MCP callers: `mcp:posts:write`.
 * This is a write tool that posts an outward-facing reply to a synced social
 * comment (or a top-level comment on a published post). The message text is
 * passed through the configured output guardrail before it leaves the app.
 * In a UI session the tool only ever returns a draft (never dispatches); the
 * human approves out-of-band via the REST reply route (see the execute() gate).
 */
@Injectable()
export class CommentReplyTool implements AgentToolInterface {
  constructor(
    private _socialCommentsService: SocialCommentsService,
    private _guardrailService: GuardrailService,
  ) {}
  name = 'commentReply';

  run() {
    return createTool({
      id: 'commentReply',
      description:
        'Reply to a synced social comment or post a first comment on a published post. Requires mcp:posts:write scope for MCP callers. The message text is guardrailed before being sent.',
      inputSchema: z.object({
        postId: z.string().describe('The post id the comment belongs to'),
        message: z.string().describe('The reply text to send'),
        commentId: z
          .string()
          .optional()
          .describe(
            'Optional comment id; if provided, the reply is threaded under that comment, otherwise it posts a top-level comment on the post'
          ),
      }),
      outputSchema: z.union([
        z.object({
          platformCommentId: z.string(),
          content: z.string(),
          authorName: z.string(),
          createdAt: z.string(),
        }),
        z.object({
          needsConfirmation: z.literal(true),
          draft: z.object({
            action: z.enum(['replyToComment', 'replyToPost']),
            postId: z.string(),
            commentId: z.string().optional(),
            message: z.string(),
          }),
        }),
      ]),
      mcp: {
        annotations: {
          title: 'Reply to Social Comment',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireWrite(ctx);
        const org = parseOrg(ctx);
        const user = parseUser(ctx);

        const guardedMessage = await guardOutbound(
          this._guardrailService,
          inputData.message,
          { userId: user.id, orgId: org.id }
        );

        // Structural, non-forgeable human-in-the-loop gate. In a browser/agent-UI
        // session (`ui === 'true'`) the tool NEVER dispatches — it always returns a
        // draft for human approval. Approval is dispatched out-of-band by the
        // frontend confirm card via the REST reply route (which re-runs the output
        // guardrail), NOT by re-invoking this tool. There is deliberately no
        // model-settable `confirmed` bypass: the acting LLM (a delegated specialist,
        // or one steered by an injected synced comment) controls the tool args, so a
        // boolean it can set is not proof of human intent. MCP/A2A/headless
        // (`ui !== 'true'`) execute directly under their granted scopes.
        if (ctx.requestContext?.get('ui') === 'true') {
          return {
            needsConfirmation: true as const,
            draft: {
              action: inputData.commentId ? 'replyToComment' : 'replyToPost',
              postId: inputData.postId,
              commentId: inputData.commentId,
              message: guardedMessage,
            },
          };
        }

        const result = inputData.commentId
          ? await this._socialCommentsService.replyToComment(
              org.id,
              user.id,
              inputData.postId,
              inputData.commentId,
              guardedMessage
            )
          : await this._socialCommentsService.replyToPost(
              org.id,
              user.id,
              inputData.postId,
              guardedMessage
            );

        const createdAt = (result as any).createdAt;
        return {
          platformCommentId: result.platformCommentId,
          content: result.content,
          authorName: result.author.name,
          createdAt: createdAt
            ? typeof createdAt === 'string'
              ? createdAt
              : createdAt.toISOString()
            : new Date().toISOString(),
        };
      },
    });
  }
}
