import { describe, it, expect, vi } from 'vitest';
import { PostsRescheduleTool } from './posts.reschedule.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makePostsService = () => ({
  changeDate: vi.fn(),
  getPostById: vi.fn().mockResolvedValue({ id: 'post-1', state: 'QUEUE' }),
});

describe('PostsRescheduleTool', () => {
  it('reschedules a post with write scope', async () => {
    const service = makePostsService();
    service.changeDate.mockResolvedValue({ id: 'post-1' });
    const tool = new PostsRescheduleTool(service as any);

    const res = await executeTool(tool, {
      inputData: { id: 'post-1', date: '2026-01-20T09:00:00.000Z' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
    });

    expect(service.changeDate).toHaveBeenCalledWith(
      'org-test-1',
      'post-1',
      '2026-01-20T09:00:00.000Z',
      'schedule'
    );
    expect(res).toEqual({
      success: true,
      id: 'post-1',
      date: '2026-01-20T09:00:00.000Z',
    });
  });

  it('denies writes without mcp:posts:write scope', async () => {
    const tool = new PostsRescheduleTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: { id: 'post-1', date: '2026-01-20T09:00:00.000Z' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:read'] },
      })
    ).rejects.toThrow('mcp:posts:write scope required');
  });

  it('denies writes in headless mode', async () => {
    const tool = new PostsRescheduleTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: { id: 'post-1', date: '2026-01-20T09:00:00.000Z' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'headless' },
      })
    ).rejects.toThrow('headless runs are read-only');
  });

  it('4.2a — rejects an unknown post id before calling changeDate', async () => {
    const service = makePostsService();
    service.getPostById.mockResolvedValue(null);
    const tool = new PostsRescheduleTool(service as any);

    await expect(
      executeTool(tool, {
        inputData: { id: 'missing', date: '2026-01-20T09:00:00.000Z' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('Post not found');
    expect(service.changeDate).not.toHaveBeenCalled();
  });

  it('4.2a — refuses to reschedule an already-PUBLISHED post', async () => {
    const service = makePostsService();
    service.getPostById.mockResolvedValue({ id: 'post-1', state: 'PUBLISHED' });
    const tool = new PostsRescheduleTool(service as any);

    await expect(
      executeTool(tool, {
        inputData: { id: 'post-1', date: '2026-01-20T09:00:00.000Z' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('already been published');
    expect(service.changeDate).not.toHaveBeenCalled();
  });
});
