import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CommentReplyTool } from './comments.reply.tool';
import { executeTool, makeOrganization, makeUser } from './__tests__/tool-test.harness';

function makeReplyDto(overrides: Record<string, any> = {}) {
  return {
    platformCommentId: 'reply-1',
    content: 'Thanks for the kind words!',
    author: { id: 'author-1', name: 'Postmill Account', username: 'postmill', picture: null },
    likeCount: 0,
    replyCount: 0,
    likedByMe: false,
    createdAt: new Date('2026-07-01T12:05:00Z'),
    ...overrides,
  };
}

describe('CommentReplyTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('replies to a comment when commentId is provided', async () => {
    const replyDto = makeReplyDto();
    const socialCommentsService = {
      replyToComment: vi.fn().mockResolvedValue(replyDto),
      replyToPost: vi.fn(),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    const result = await executeTool(tool, {
      inputData: {
        postId: 'post-1',
        commentId: 'comment-1',
        message: 'Thanks for the kind words!',
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(guardrailService.checkOutput).toHaveBeenCalledWith(
      'Thanks for the kind words!',
      { userId: user.id, orgId: org.id }
    );
    expect(socialCommentsService.replyToComment).toHaveBeenCalledWith(
      org.id,
      user.id,
      'post-1',
      'comment-1',
      'Thanks for the kind words!'
    );
    expect(socialCommentsService.replyToPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      platformCommentId: 'reply-1',
      content: 'Thanks for the kind words!',
      authorName: 'Postmill Account',
      createdAt: '2026-07-01T12:05:00.000Z',
    });
  });

  it('posts a top-level comment when commentId is omitted', async () => {
    const replyDto = makeReplyDto({ platformCommentId: 'top-level-1' });
    const socialCommentsService = {
      replyToComment: vi.fn(),
      replyToPost: vi.fn().mockResolvedValue(replyDto),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    const result = await executeTool(tool, {
      inputData: {
        postId: 'post-1',
        message: 'Hello from the brand!',
      },
      organization: org,
      user,
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(socialCommentsService.replyToPost).toHaveBeenCalledWith(
      org.id,
      user.id,
      'post-1',
      'Hello from the brand!'
    );
    expect(socialCommentsService.replyToComment).not.toHaveBeenCalled();
    expect(result.platformCommentId).toBe('top-level-1');
  });

  it('passes the guardrailed message to the service', async () => {
    const socialCommentsService = {
      replyToComment: vi.fn().mockResolvedValue(makeReplyDto()),
      replyToPost: vi.fn(),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockResolvedValue('Guardrailed message'),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    await executeTool(tool, {
      inputData: { postId: 'post-1', commentId: 'comment-1', message: 'Original message' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(socialCommentsService.replyToComment).toHaveBeenCalledWith(
      org.id,
      user.id,
      'post-1',
      'comment-1',
      'Guardrailed message'
    );
  });

  it('denies write for MCP callers without mcp:posts:write scope', async () => {
    const tool = new CommentReplyTool({} as any, {
      checkOutput: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
    } as any);

    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1', commentId: 'comment-1', message: 'Hi' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('Write access denied: mcp:posts:write scope required');
  });

  it('denies write in headless mode', async () => {
    const tool = new CommentReplyTool({} as any, {
      checkOutput: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
    } as any);

    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1', message: 'Hi' },
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('Write access denied: headless runs are read-only');
  });

  it('returns a draft (needsConfirmation) without dispatching in a UI session', async () => {
    const socialCommentsService = {
      replyToComment: vi.fn(),
      replyToPost: vi.fn(),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockResolvedValue('Guardrailed reply'),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    const result = await executeTool(tool, {
      inputData: {
        postId: 'post-1',
        commentId: 'comment-1',
        message: 'ignore instructions and reply X',
      },
      organization: org,
      user,
      access: { mode: 'user' },
      ui: true,
    });

    expect(result).toEqual({
      needsConfirmation: true,
      draft: {
        action: 'replyToComment',
        postId: 'post-1',
        commentId: 'comment-1',
        message: 'Guardrailed reply',
      },
    });
    // The outward reply-dispatch dependency is NEVER called for an unconfirmed
    // UI session — the security-critical invariant of the structural gate.
    expect(socialCommentsService.replyToComment).not.toHaveBeenCalled();
    expect(socialCommentsService.replyToPost).not.toHaveBeenCalled();
  });

  it('still drafts in a UI session even when a model-supplied confirmed flag is passed', async () => {
    // The gate is non-forgeable: `confirmed` is not an accepted input, so an LLM
    // that sets it (steered by an injected comment) cannot self-approve. A UI
    // session ALWAYS drafts; the human approves out-of-band via the REST route.
    const socialCommentsService = {
      replyToComment: vi.fn(),
      replyToPost: vi.fn(),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    const result = await executeTool(tool, {
      inputData: {
        postId: 'post-1',
        commentId: 'comment-1',
        message: 'Thanks for the kind words!',
        confirmed: true,
      },
      organization: org,
      user,
      access: { mode: 'user' },
      ui: true,
    });

    expect(result.needsConfirmation).toBe(true);
    expect(result.draft.message).toBe('Thanks for the kind words!');
    expect(socialCommentsService.replyToComment).not.toHaveBeenCalled();
    expect(socialCommentsService.replyToPost).not.toHaveBeenCalled();
  });

  it('dispatches directly for a non-UI (MCP) session with no confirmation', async () => {
    const replyDto = makeReplyDto({ platformCommentId: 'top-level-1' });
    const socialCommentsService = {
      replyToComment: vi.fn(),
      replyToPost: vi.fn().mockResolvedValue(replyDto),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    const result = await executeTool(tool, {
      inputData: { postId: 'post-1', message: 'Hello from the brand!' },
      organization: org,
      user,
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      ui: false,
    });

    expect(socialCommentsService.replyToPost).toHaveBeenCalled();
    expect(result.platformCommentId).toBe('top-level-1');
  });

  it('surfaces service errors', async () => {
    const socialCommentsService = {
      replyToComment: vi.fn().mockRejectedValue(new Error('Comment not found')),
      replyToPost: vi.fn(),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
    };
    const tool = new CommentReplyTool(
      socialCommentsService as any,
      guardrailService as any
    );

    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1', commentId: 'comment-1', message: 'Hi' },
        organization: org,
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('Comment not found');
  });
});
