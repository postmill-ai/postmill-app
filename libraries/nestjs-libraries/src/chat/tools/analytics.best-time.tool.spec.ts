import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsBestTimeTool } from './analytics.best-time.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

describe('AnalyticsBestTimeTool', () => {
  let analyticsService: { getBestTimeData: ReturnType<typeof vi.fn> };
  let tool: AnalyticsBestTimeTool;

  beforeEach(() => {
    analyticsService = {
      getBestTimeData: vi.fn().mockResolvedValue({
        heatmap: [],
        bestSlots: [
          { day: 1, hour: 9, avgEngagement: 120 },
          { day: 3, hour: 18, avgEngagement: 95 },
        ],
      }),
    };
    tool = new AnalyticsBestTimeTool(analyticsService as any);
  });

  it('returns best time slots for the org', async () => {
    const res = await executeTool(tool, {
      inputData: {},
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getBestTimeData).toHaveBeenCalledWith(
      'org-test-1',
      undefined
    );
    expect(res.bestSlots).toEqual([
      { day: 1, hour: 9, avgEngagement: 120 },
      { day: 3, hour: 18, avgEngagement: 95 },
    ]);
  });

  it('passes integrationIds when provided', async () => {
    await executeTool(tool, {
      inputData: { integrationIds: ['int-1'] },
      organization: makeOrganization(),
      user: makeUser(),
      access: { mode: 'user' },
    });

    expect(analyticsService.getBestTimeData).toHaveBeenCalledWith(
      'org-test-1',
      ['int-1']
    );
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
