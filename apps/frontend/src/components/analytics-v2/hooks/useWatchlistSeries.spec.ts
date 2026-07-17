import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useWatchlistSeries } from './useWatchlistSeries';

const mockUseSWR = vi.mocked(useSWR);

describe('useWatchlistSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('is disabled (null key) when no id is provided', () => {
    renderHook(() => useWatchlistSeries(undefined));
    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
  });

  it('keys by the account id + metric + range', () => {
    renderHook(() => useWatchlistSeries('w1', 'followers', '2024-01-01', '2024-02-01'));
    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/watchlist/w1/series');
    expect(key).toContain('metric=followers');
    expect(key).toContain('from=2024-01-01');
    expect(key).toContain('to=2024-02-01');
  });

  it('load fetcher throws on failure', async () => {
    renderHook(() => useWatchlistSeries('w1'));
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(load('/x')).rejects.toThrow('Failed to load watchlist series');
  });
});
