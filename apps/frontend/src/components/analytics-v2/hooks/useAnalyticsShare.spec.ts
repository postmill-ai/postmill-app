import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

const mockMutate = vi.fn();
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useAnalyticsShare } from './useAnalyticsShare';

const mockUseSWR = vi.mocked(useSWR);

describe('useAnalyticsShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({
      data: { token: null, enabled: false, config: {} },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    } as any);
  });

  it('reads the share config resource', () => {
    renderHook(() => useAnalyticsShare());
    expect(mockUseSWR.mock.calls[0][0]).toBe('/analytics/v2/share');
  });

  it('save POSTs the config and seeds the cache', async () => {
    const returned = { token: 'abc', enabled: true, config: { rangePreset: 'last_30d' } };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => returned });
    const { result } = renderHook(() => useAnalyticsShare());
    const out = await result.current.save({ rangePreset: 'last_30d' });
    expect(out).toEqual(returned);
    expect(mockFetchFn.mock.calls[0][1].method).toBe('POST');
    expect(mockMutate).toHaveBeenCalledWith(returned, { revalidate: false });
  });

  it('disable DELETEs and revalidates', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useAnalyticsShare());
    await result.current.disable();
    expect(mockFetchFn.mock.calls[0][0]).toBe('/analytics/v2/share');
    expect(mockFetchFn.mock.calls[0][1].method).toBe('DELETE');
    expect(mockMutate).toHaveBeenCalled();
  });
});
