import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { AnalyticsWatchlistTool } from './analytics.watchlist.tool';
import {
  executeTool,
  makeOrganization,
  makeUser,
} from './__tests__/tool-test.harness';

const org = makeOrganization();
const user = makeUser();

function makeWatchlistService(overrides: Record<string, any> = {}) {
  return {
    list: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'wa-1',
    organizationId: org.id,
    provider: 'x',
    handle: 'competitor',
    displayName: 'Competitor Inc',
    enabled: true,
    lastError: null,
    metrics: [
      {
        id: 'wam-1',
        metric: 'followers_count',
        value: 12345,
        capturedAt: new Date('2026-07-01T12:00:00Z'),
      },
    ],
    ...overrides,
  };
}

describe('AnalyticsWatchlistTool', () => {
  it('returns trimmed watchlist entries with the latest metric', async () => {
    const watchlistService = makeWatchlistService({
      list: vi.fn().mockResolvedValue([
        makeAccount(),
        makeAccount({
          id: 'wa-2',
          provider: 'instagram',
          handle: 'another',
          displayName: null,
          metrics: [],
          lastError: 'No public metric found',
        }),
      ]),
    });

    const tool = new AnalyticsWatchlistTool(watchlistService as any);
    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(watchlistService.list).toHaveBeenCalledWith(org.id);
    expect(result.output).toHaveLength(2);
    expect(result.output[0]).toEqual({
      provider: 'x',
      handle: 'competitor',
      displayName: 'Competitor Inc',
      metric: 'followers_count',
      value: 12345,
      capturedAt: '2026-07-01T12:00:00.000Z',
      lastError: null,
    });
    expect(result.output[1]).toEqual({
      provider: 'instagram',
      handle: 'another',
      displayName: null,
      metric: null,
      value: null,
      capturedAt: null,
      lastError: 'No public metric found',
    });
  });

  it('filters to enabled accounts when enabledOnly is true', async () => {
    const watchlistService = makeWatchlistService({
      list: vi.fn().mockResolvedValue([
        makeAccount({ id: 'wa-1', enabled: true }),
        makeAccount({ id: 'wa-2', enabled: false }),
      ]),
    });

    const tool = new AnalyticsWatchlistTool(watchlistService as any);
    const result = await executeTool(tool, {
      inputData: { enabledOnly: true },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.output).toHaveLength(1);
    expect(result.output[0].handle).toBe('competitor');
  });

  it('throws when read access is denied', async () => {
    const tool = new AnalyticsWatchlistTool(makeWatchlistService() as any);

    await expect(
      executeTool(tool, {
        inputData: {},
        organization: org,
        user,
        access: { mode: 'mcp', scopes: ['mcp:posts:write'] },
      })
    ).rejects.toThrow('mcp:read scope required');
  });

  it('throws when organization context is missing', async () => {
    const tool = new AnalyticsWatchlistTool(makeWatchlistService() as any);

    await expect(
      executeTool(tool, {
        inputData: {},
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('Organization context missing');
  });
});
