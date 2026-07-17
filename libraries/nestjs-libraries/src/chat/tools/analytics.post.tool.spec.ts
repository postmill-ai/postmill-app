import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsPostTool } from './analytics.post.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makePostDetail = () => ({
  postId: 'post-1',
  content: 'Hello world',
  integration: {
    id: 'int-1',
    name: 'Twitter',
    identifier: 'twitter',
    picture: '/pic.jpg',
  },
  publishedAt: '2024-01-01T12:00:00.000Z',
  metrics: {
    impressions: [{ date: '2024-01-01', value: 100 }],
  },
});

describe('AnalyticsPostTool', () => {
  let analyticsService: { getPostDetail: ReturnType<typeof vi.fn> };
  let tool: AnalyticsPostTool;

  beforeEach(() => {
    analyticsService = {
      getPostDetail: vi.fn().mockResolvedValue(makePostDetail()),
    };
    tool = new AnalyticsPostTool(analyticsService as any);
  });

  it('returns post analytics detail', async () => {
    const res = await executeTool(tool, {
      inputData: { postId: 'post-1', date: '30' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getPostDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'org-test-1' }),
      'post-1',
      '30'
    );
    expect(res).toEqual(makePostDetail());
  });

  it('defaults date when not provided', async () => {
    await executeTool(tool, {
      inputData: { postId: 'post-1' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getPostDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'org-test-1' }),
      'post-1',
      undefined
    );
  });

  it('maps NotFoundException to a structured error', async () => {
    analyticsService.getPostDetail.mockRejectedValue(
      new NotFoundException('Post not found')
    );

    const res = await executeTool(tool, {
      inputData: { postId: 'missing' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(res).toEqual({ error: 'Post not found' });
  });

  it('rethrows unexpected errors', async () => {
    analyticsService.getPostDetail.mockRejectedValue(new Error('boom'));

    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'user' },
      })
    ).rejects.toThrow('boom');
  });

  it('requires read access', async () => {
    await expect(
      executeTool(tool, {
        inputData: { postId: 'post-1' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: [] },
      })
    ).rejects.toThrow('mcp:read scope required');
  });
});
