import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { usePublicAnalyticsReport } from './usePublicAnalyticsReport';

const mockUseSWR = vi.mocked(useSWR);

describe('usePublicAnalyticsReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('is disabled (null key) without a token', () => {
    renderHook(() => usePublicAnalyticsReport(undefined));
    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
  });

  it('keys by the token and hits the public route', async () => {
    renderHook(() => usePublicAnalyticsReport('tok123'));
    expect(mockUseSWR.mock.calls[0][0]).toBe('public-analytics-report-tok123');
    const load = mockUseSWR.mock.calls[0][1] as () => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => ({ kpis: [] }) });
    await load();
    expect(mockFetchFn.mock.calls[0][0]).toBe('/public/analytics-report/tok123');
  });
});
