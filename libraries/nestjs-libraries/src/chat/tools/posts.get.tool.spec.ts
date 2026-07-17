import { describe, it, expect, vi } from 'vitest';
import { PostsGetTool } from './posts.get.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makePostsService = () => ({
  getPost: vi.fn(),
});

describe('PostsGetTool', () => {
  it('returns a summarized post group', async () => {
    const service = makePostsService();
    service.getPost.mockResolvedValue({
      group: 'group-1',
      integration: 'int-1',
      integrationPicture: 'http://pic.png',
      settings: { color: '#fff' },
      posts: [
        {
          id: 'post-1',
          content: '<p>Main post</p>',
          state: 'QUEUE',
          publishDate: '2026-01-15T10:00:00.000Z',
          image: [{ id: 'img-1', path: '/a.png' }],
        },
        {
          id: 'post-2',
          content: '<p>Follow-up comment</p>',
          state: 'QUEUE',
          publishDate: '2026-01-15T10:05:00.000Z',
          image: [],
        },
      ],
    });
    const tool = new PostsGetTool(service as any);

    const res = await executeTool(tool, {
      inputData: { id: 'post-1' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(service.getPost).toHaveBeenCalledWith('org-test-1', 'post-1');
    expect(res.group).toBe('group-1');
    expect(res.integrationId).toBe('int-1');
    expect(res.settings).toEqual({ color: '#fff' });
    expect(res.posts).toHaveLength(2);
    expect(res.posts[0].imageCount).toBe(1);
    expect(res.posts[1].imageCount).toBe(0);
  });

  it('handles missing optional fields', async () => {
    const service = makePostsService();
    service.getPost.mockResolvedValue({
      posts: [{ id: 'post-1' }],
    });
    const tool = new PostsGetTool(service as any);

    const res = await executeTool(tool, {
      inputData: { id: 'post-1' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(res.group).toBeUndefined();
    expect(res.settings).toEqual({});
    expect(res.posts[0].contentPreview).toBe('');
    expect(res.posts[0].imageCount).toBe(0);
  });

  it('denies read without access context', async () => {
    const tool = new PostsGetTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: { id: 'post-1' },
        organization: makeOrganization(),
        user: makeUser(),
      })
    ).rejects.toThrow('Read access denied');
  });
});
