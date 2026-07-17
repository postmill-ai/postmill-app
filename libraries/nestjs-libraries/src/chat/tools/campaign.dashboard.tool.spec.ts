import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CampaignDashboardTool } from './campaign.dashboard.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

function makeDashboard(overrides: any = {}) {
  return {
    campaign: {
      id: 'c1',
      name: 'Launch',
      color: null,
      description: null,
      startDate: null,
      endDate: null,
      archived: false,
      utmEnabled: false,
      client: null,
      project: null,
      tags: ['paid'],
      ...overrides.campaign,
    },
    engagement: {
      totalViews: 100,
      totalLikes: 20,
      totalComments: 5,
      avgViews: 100,
      avgLikes: 20,
      avgComments: 5,
      topPost: null,
      ...overrides.engagement,
    },
    stateCounts: { DRAFT: 1, QUEUE: 2 },
    upcoming: [
      {
        id: 'p1',
        title: 'First post',
        publishDate: new Date('2026-01-02T10:00:00.000Z'),
        integration: { name: 'X' },
      },
    ],
    channels: [
      {
        id: 'i1',
        name: 'X Account',
        providerIdentifier: 'x',
        postCount: 2,
      },
    ],
    clickTotal: 0,
    goals: [{ metric: 'views', target: 1000 }],
    posts: [],
    itemPanels: {},
    recentChangelog: [],
    ...overrides,
  };
}

describe('CampaignDashboardTool', () => {
  const org = makeOrganization();
  const user = makeUser();

  it('returns a summarized dashboard', async () => {
    const campaignsService = {
      getDashboard: vi.fn().mockResolvedValue(makeDashboard()),
    };
    const tool = new CampaignDashboardTool(campaignsService as any);

    const result = await executeTool(tool, {
      inputData: { id: 'c1' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(campaignsService.getDashboard).toHaveBeenCalledWith('c1', org.id);
    expect(result).not.toHaveProperty('error');
    expect(result).toMatchObject({
      id: 'c1',
      name: 'Launch',
      engagement: {
        totalViews: 100,
        totalLikes: 20,
        totalComments: 5,
      },
      stateCounts: { DRAFT: 1, QUEUE: 2 },
      channels: [{ id: 'i1', name: 'X Account', providerIdentifier: 'x', postCount: 2 }],
      upcoming: [
        {
          id: 'p1',
          title: 'First post',
          integrationName: 'X',
        },
      ],
    });
  });

  it('maps NotFoundException to an error object', async () => {
    const campaignsService = {
      getDashboard: vi
        .fn()
        .mockRejectedValue(new NotFoundException('Campaign not found')),
    };
    const tool = new CampaignDashboardTool(campaignsService as any);

    const result = await executeTool(tool, {
      inputData: { id: 'missing' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toEqual({ error: 'Campaign not found' });
  });

  it('denies read without the required scope', async () => {
    const tool = new CampaignDashboardTool({ getDashboard: vi.fn() } as any);

    await expect(
      executeTool(tool, {
        inputData: { id: 'c1' },
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('mcp:read scope required');
  });
});
