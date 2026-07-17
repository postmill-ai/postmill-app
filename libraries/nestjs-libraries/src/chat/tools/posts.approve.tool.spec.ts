import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PostsApproveTool } from './posts.approve.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makePostsService = () => ({
  approveDraft: vi.fn(),
});

describe('PostsApproveTool', () => {
  it('approves a draft with write scope', async () => {
    const service = makePostsService();
    service.approveDraft.mockResolvedValue({
      id: 'post-1',
      approvalStatus: 'approved',
    });
    const tool = new PostsApproveTool(service as any);

    const res = await executeTool(tool, {
      inputData: { postId: 'post-1' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(service.approveDraft).toHaveBeenCalledWith(
      'org-test-1',
      'post-1',
      'user-test-1'
    );
    expect(res).toEqual({ id: 'post-1', approvalStatus: 'approved' });
  });

  it('maps BadRequestException to an error object', async () => {
    const service = makePostsService();
    service.approveDraft.mockRejectedValue(
      new BadRequestException('Draft not found')
    );
    const tool = new PostsApproveTool(service as any);

    const res = await executeTool(tool, {
      inputData: { postId: 'post-1' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(res).toEqual({ error: 'Draft not found' });
  });

  it('rethrows non-BadRequest errors', async () => {
    const service = makePostsService();
    service.approveDraft.mockRejectedValue(new Error('DB down'));
    const tool = new PostsApproveTool(service as any);

    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('DB down');
  });

  it('denies writes without mcp:posts:write scope', async () => {
    const tool = new PostsApproveTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
  });
});
