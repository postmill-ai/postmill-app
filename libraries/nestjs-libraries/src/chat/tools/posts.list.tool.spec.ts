import { describe, it, expect, vi } from 'vitest';
import { PostsListTool } from './posts.list.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makePostsService = () => ({
  getPostsMinified: vi.fn(),
  getPostsList: vi.fn(),
});

const minifiedPost = (overrides: Record<string, any> = {}) => ({
  i: 'post-1',
  c: '<p>Hello world</p>',
  d: '2026-01-15T10:00:00.000Z',
  s: 'QUEUE',
  g: 'group-1',
  ci: 'campaign-1',
  n: {
    i: 'int-1',
    n: 'X Account',
    pi: 'x',
  },
  ...overrides,
});

describe('PostsListTool', () => {
  it('lists posts in date-range mode with trimmed output', async () => {
    const service = makePostsService();
    service.getPostsMinified.mockResolvedValue({
      p: [minifiedPost()],
    });
    const tool = new PostsListTool(service as any);

    const res = await executeTool(tool, {
      inputData: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(service.getPostsMinified).toHaveBeenCalledWith(
      'org-test-1',
      expect.objectContaining({
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
        display: 'list',
        limit: 50,
      }),
      'user-test-1'
    );
    expect(res.posts).toHaveLength(1);
    expect(res.posts[0]).toEqual({
      id: 'post-1',
      group: 'group-1',
      state: 'QUEUE',
      publishDate: '2026-01-15T10:00:00.000Z',
      integration: {
        id: 'int-1',
        name: 'X Account',
        providerIdentifier: 'x',
      },
      campaignId: 'campaign-1',
      contentPreview: 'Hello world',
    });
  });

  it('lists posts in filter/list mode with pagination', async () => {
    const service = makePostsService();
    service.getPostsList.mockResolvedValue({
      p: [minifiedPost({ s: 'DRAFT' })],
      t: 1,
      pg: 0,
      l: 20,
      hm: false,
    });
    const tool = new PostsListTool(service as any);

    const res = await executeTool(tool, {
      inputData: { state: 'draft', page: 0, limit: 20 },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(service.getPostsList).toHaveBeenCalledWith(
      'org-test-1',
      expect.objectContaining({ state: 'draft', page: 0, limit: 20 }),
      'user-test-1'
    );
    expect(res.posts[0].state).toBe('DRAFT');
  });

  it('filters by campaignId and integrationId in-tool', async () => {
    const service = makePostsService();
    service.getPostsMinified.mockResolvedValue({
      p: [
        minifiedPost({ ci: 'camp-a', n: { i: 'int-a', n: 'A', pi: 'x' } }),
        minifiedPost({ ci: 'camp-b', n: { i: 'int-a', n: 'A', pi: 'x' } }),
        minifiedPost({ ci: 'camp-a', n: { i: 'int-b', n: 'B', pi: 'linkedin' } }),
      ],
    });
    const tool = new PostsListTool(service as any);

    const res = await executeTool(tool, {
      inputData: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
        campaignId: 'camp-a',
        integrationId: 'int-a',
      },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(res.posts).toHaveLength(1);
    expect(res.posts[0].campaignId).toBe('camp-a');
    expect(res.posts[0].integration.id).toBe('int-a');
  });

  it('caps output at 50 posts', async () => {
    const service = makePostsService();
    service.getPostsList.mockResolvedValue({
      p: Array.from({ length: 60 }, (_, i) => minifiedPost({ i: `post-${i}` })),
      t: 60,
      pg: 0,
      l: 100,
      hm: true,
    });
    const tool = new PostsListTool(service as any);

    const res = await executeTool(tool, {
      inputData: { limit: 100 },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(res.posts).toHaveLength(50);
  });

  it('denies read without access context', async () => {
    const tool = new PostsListTool(makePostsService() as any);
    await expect(
      executeTool(tool, {
        inputData: {},
        organization: makeOrganization(),
        user: makeUser(),
      })
    ).rejects.toThrow('Read access denied');
  });
});
