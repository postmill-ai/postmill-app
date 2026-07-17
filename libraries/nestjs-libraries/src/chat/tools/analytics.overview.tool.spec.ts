import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsOverviewTool } from './analytics.overview.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const makeOverviewResponse = () => ({
  range: { from: '2024-01-01', to: '2024-01-31' },
  kpis: [
    {
      metric: 'impressions',
      label: 'Impressions',
      format: 'count',
      total: 1000,
      previousTotal: 800,
      percentageChange: 25,
      sparkline: [{ date: '2024-01-01', value: 10 }],
    },
  ],
  series: { impressions: [{ date: '2024-01-01', value: 10 }] },
  byChannel: [
    {
      integrationId: 'int-1',
      name: 'Twitter',
      identifier: 'twitter',
      picture: '/pic.jpg',
      kpis: [
        {
          metric: 'impressions',
          label: 'Impressions',
          format: 'count',
          total: 1000,
          previousTotal: 800,
          percentageChange: 25,
        },
      ],
    },
  ],
  breakdown: { byPlatform: [{ identifier: 'twitter', value: 1000 }] },
});

describe('AnalyticsOverviewTool', () => {
  let analyticsService: { getOverview: ReturnType<typeof vi.fn> };
  let tool: AnalyticsOverviewTool;

  beforeEach(() => {
    analyticsService = {
      getOverview: vi.fn().mockResolvedValue(makeOverviewResponse()),
    };
    tool = new AnalyticsOverviewTool(analyticsService as any);
  });

  it('returns a trimmed analytics overview', async () => {
    const res = await executeTool(tool, {
      inputData: { from: '2024-01-01', to: '2024-01-31' },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'org-test-1' }),
      '2024-01-01',
      '2024-01-31',
      [],
      false
    );
    expect(res.range).toEqual({ from: '2024-01-01', to: '2024-01-31' });
    expect(res.kpis[0]).not.toHaveProperty('sparkline');
    expect(res.kpis[0].total).toBe(1000);
    expect(res.byChannel).toHaveLength(1);
    expect(res.breakdown.byPlatform[0].value).toBe(1000);
  });

  it('passes integrationIds and compare when provided', async () => {
    await executeTool(tool, {
      inputData: {
        from: '2024-02-01',
        to: '2024-02-28',
        integrationIds: ['int-1', 'int-2'],
        compare: true,
      },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'org-test-1' }),
      '2024-02-01',
      '2024-02-28',
      ['int-1', 'int-2'],
      true
    );
  });

  it('denies read without read access', async () => {
    await expect(
      executeTool(tool, {
        inputData: { from: '2024-01-01', to: '2024-01-31' },
        organization: makeOrganization(),
        user: makeUser(),
        access: { mode: 'mcp', scopes: [] },
      })
    ).rejects.toThrow('mcp:read scope required');
  });
});
