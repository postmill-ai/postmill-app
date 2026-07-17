import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useChannelMetric } from './useChannelMetric';

const mockUseSWR = vi.mocked(useSWR);

const baseParams = {
  integrationId: 'i1',
  metric: 'impressions',
  from: '2026-01-01',
  to: '2026-01-31',
  compare: true,
};

describe('useChannelMetric', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('builds the channel-metric SWR key from the params', () => {
    renderHook(() => useChannelMetric(baseParams));
    expect(mockUseSWR.mock.calls[0][0]).toBe(
      '/analytics/v2/channel/i1/metric/impressions?from=2026-01-01&to=2026-01-31&compare=true'
    );
  });

  it('url-encodes the integration id and metric', () => {
    renderHook(() =>
      useChannelMetric({ ...baseParams, integrationId: 'a/b', metric: 'a b' })
    );
    expect(mockUseSWR.mock.calls[0][0]).toBe(
      '/analytics/v2/channel/a%2Fb/metric/a%20b?from=2026-01-01&to=2026-01-31&compare=true'
    );
  });

  it('serializes compare=false', () => {
    renderHook(() => useChannelMetric({ ...baseParams, compare: false }));
    expect(mockUseSWR.mock.calls[0][0]).toContain('compare=false');
  });

  it('passes a null key when integrationId is empty', () => {
    renderHook(() => useChannelMetric({ ...baseParams, integrationId: '' }));
    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
  });

  it('passes a null key when metric is empty', () => {
    renderHook(() => useChannelMetric({ ...baseParams, metric: '' }));
    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
  });

  it('load fetcher returns json on success', async () => {
    renderHook(() => useChannelMetric(baseParams));
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    const payload = { metric: 'impressions', total: 10 };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(payload) });
    await expect(load('/x')).resolves.toEqual(payload);
    expect(mockFetchFn).toHaveBeenCalledWith('/x');
  });

  it('load fetcher throws on failure', async () => {
    renderHook(() => useChannelMetric(baseParams));
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(load('/x')).rejects.toThrow('Failed to fetch channel metric');
  });
});
