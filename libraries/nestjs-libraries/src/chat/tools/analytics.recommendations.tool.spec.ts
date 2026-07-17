import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsRecommendationsTool } from './analytics.recommendations.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

describe('AnalyticsRecommendationsTool', () => {
  let analyticsService: { getRecommendations: ReturnType<typeof vi.fn> };
  let tool: AnalyticsRecommendationsTool;

  beforeEach(() => {
    analyticsService = {
      getRecommendations: vi.fn().mockResolvedValue({
        recommendations: [
          {
            type: 'best_time',
            title: 'Best time to post: Monday at 9:00',
            description: 'Highest engagement window.',
            action: 'Schedule a post',
            link: '/posts',
            priority: 1,
          },
        ],
      }),
    };
    tool = new AnalyticsRecommendationsTool(analyticsService as any);
  });

  it('returns recommendations for the org', async () => {
    const res = await executeTool(tool, {
      inputData: {},
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'org-test-1' })
    );
    expect(res.recommendations).toHaveLength(1);
    expect(res.recommendations[0].type).toBe('best_time');
  });

  it('requires read access', async () => {
    await expect(
      executeTool(tool, {
        inputData: {},
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('mcp:read scope required');
  });
});
