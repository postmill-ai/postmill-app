import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { PostsGetTool } from '../posts.get.tool';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

describe('PostsGetTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('returns { error: "Post not found" } for an unknown id without throwing', async () => {
    // Reproduce the real service: an empty org-scoped result → the service
    // dereferences posts[0].integrationId and throws a TypeError.
    const postsService = {
      getPost: vi
        .fn()
        .mockRejectedValue(
          new TypeError(
            "Cannot read properties of undefined (reading 'integrationId')"
          )
        ),
    };
    const tool = new PostsGetTool(postsService as any);

    const result = await executeTool(tool, {
      inputData: { id: 'does-not-exist' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toEqual({ error: 'Post not found' });
  });

  it('summarizes a found post group', async () => {
    const postsService = {
      getPost: vi.fn().mockResolvedValue({
        group: 'grp-1',
        integration: 'int-1',
        integrationPicture: 'https://example.com/x.png',
        settings: { firstComment: 'hi' },
        posts: [
          {
            id: 'post-1',
            content: '<p>Hello world</p>',
            state: 'DRAFT',
            publishDate: null,
            image: [],
          },
        ],
      }),
    };
    const tool = new PostsGetTool(postsService as any);

    const result = await executeTool(tool, {
      inputData: { id: 'post-1' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toMatchObject({ group: 'grp-1', integrationId: 'int-1' });
    expect(result.posts[0]).toMatchObject({ id: 'post-1', imageCount: 0 });
    expect(result.error).toBeUndefined();
  });
});
