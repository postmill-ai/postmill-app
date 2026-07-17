import { describe, it, expect, vi } from 'vitest';
import { PostsDeleteTool } from './posts.delete.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makePostsService = () => ({
  deletePost: vi.fn(),
});

describe('PostsDeleteTool', () => {
  it('deletes a post group with write scope', async () => {
    const service = makePostsService();
    service.deletePost.mockResolvedValue({ id: 'post-1' });
    const tool = new PostsDeleteTool(service as any);

    const res = await executeTool(tool, {
      inputData: { group: 'group-1' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(service.deletePost).toHaveBeenCalledWith('org-test-1', 'group-1');
    expect(res).toEqual({ success: true, group: 'group-1' });
  });

  it('denies writes without mcp:posts:write scope', async () => {
    const tool = new PostsDeleteTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: { group: 'group-1' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
  });

  it('denies writes in headless mode', async () => {
    const tool = new PostsDeleteTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: { group: 'group-1' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('headless runs are read-only');
  });
});
