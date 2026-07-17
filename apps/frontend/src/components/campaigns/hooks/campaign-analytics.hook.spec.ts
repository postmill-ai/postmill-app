import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';

const mockFetch = vi.fn();
const mockT = (key: string, fallback: string) => fallback;
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

import {
  useCampaignAnalytics,
  resolveCampaignAnalyticsRange,
  CAMPAIGN_SNAPSHOT_WINDOW_DAYS,
} from './campaign.hooks';

describe('resolveCampaignAnalyticsRange', () => {
  const today = dayjs().format('YYYY-MM-DD');

  it('ongoing campaign (no endDate) → start date through today', () => {
    const { from, to } = resolveCampaignAnalyticsRange('2020-01-01', null);
    expect(to).toBe(today);
    expect(from).toBe('2020-01-01');
  });

  it('ongoing campaign with no start date → default 90-day lookback to today', () => {
    const { from, to } = resolveCampaignAnalyticsRange(null, null);
    expect(to).toBe(today);
    expect(from).toBe(
      dayjs().subtract(CAMPAIGN_SNAPSHOT_WINDOW_DAYS, 'day').format('YYYY-MM-DD')
    );
  });

  it('keeps a start earlier than 90 days (rows survive via weekly rollup)', () => {
    const { from } = resolveCampaignAnalyticsRange(
      '2000-01-01',
      dayjs().add(5, 'day').format('YYYY-MM-DD')
    );
    expect(from).toBe('2000-01-01');
  });

  it('campaign ended >90 days ago → from ≤ to, not an inverted empty range', () => {
    const start = dayjs().subtract(150, 'day').format('YYYY-MM-DD');
    const end = dayjs().subtract(120, 'day').format('YYYY-MM-DD');
    const { from, to } = resolveCampaignAnalyticsRange(start, end);
    expect(to).toBe(end);
    expect(from).toBe(start);
    expect(dayjs(from).isAfter(dayjs(to))).toBe(false);
  });

  it('clamps from down to to when the start is after the (past) end', () => {
    // Pathological: start after end. from must collapse to to, never invert.
    const start = dayjs().subtract(100, 'day').format('YYYY-MM-DD');
    const end = dayjs().subtract(120, 'day').format('YYYY-MM-DD');
    const { from, to } = resolveCampaignAnalyticsRange(start, end);
    expect(to).toBe(end);
    expect(from).toBe(end);
  });

  it('clamps an end in the future down to today', () => {
    const { to } = resolveCampaignAnalyticsRange(
      dayjs().subtract(10, 'day').format('YYYY-MM-DD'),
      dayjs().add(30, 'day').format('YYYY-MM-DD')
    );
    expect(to).toBe(today);
  });

  it('keeps an in-window start/end unchanged', () => {
    const start = dayjs().subtract(20, 'day').format('YYYY-MM-DD');
    const end = dayjs().subtract(2, 'day').format('YYYY-MM-DD');
    const { from, to } = resolveCampaignAnalyticsRange(start, end);
    expect(from).toBe(start);
    expect(to).toBe(end);
  });
});

describe('useCampaignAnalytics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the campaign analytics endpoint with from/to and returns the data', async () => {
    const payload = { range: { from: '2024-01-01', to: '2024-01-07' }, kpis: [], series: {}, byChannel: [] };
    mockFetch.mockResolvedValue({ ok: true, json: async () => payload });

    const { result } = renderHook(() =>
      useCampaignAnalytics('c1', '2024-01-01', '2024-01-07')
    );

    await waitFor(() => expect(result.current.data).toEqual(payload));
    expect(mockFetch).toHaveBeenCalledWith(
      '/campaigns/c1/analytics?from=2024-01-01&to=2024-01-07'
    );
  });

  it('omits the query string when no range is passed', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ series: {} }) });
    const { result } = renderHook(() => useCampaignAnalytics('c2'));
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledWith('/campaigns/c2/analytics');
  });

  it('does not fetch when no campaignId is given', () => {
    renderHook(() => useCampaignAnalytics(undefined));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
