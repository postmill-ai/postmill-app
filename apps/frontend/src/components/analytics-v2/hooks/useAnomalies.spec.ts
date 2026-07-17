import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockFetchFn = vi.fn();
const mockMutate = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('swr', () => ({
  default: vi.fn(),
}));

import useSWR from 'swr';
import { useAnomalies, AnomalyRow } from './useAnomalies';

const mockUseSWR = vi.mocked(useSWR);

function stubSwr(overrides: { data?: any; error?: any; isLoading?: boolean } = {}) {
  mockUseSWR.mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: mockMutate,
    ...overrides,
  } as any);
}

describe('useAnomalies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate.mockResolvedValue(undefined);
  });

  it('uses the anomalies endpoint as the SWR key (undismissed by default)', () => {
    stubSwr({ isLoading: true });
    renderHook(() => useAnomalies());
    expect(mockUseSWR.mock.calls[0][0]).toBe('/analytics/v2/anomalies');
  });

  it('adds includeDismissed=true to the key when requested', () => {
    stubSwr({ isLoading: true });
    renderHook(() => useAnomalies(true));
    expect(mockUseSWR.mock.calls[0][0]).toBe(
      '/analytics/v2/anomalies?includeDismissed=true'
    );
  });

  it('fetcher throws on a non-ok response', async () => {
    stubSwr({});
    renderHook(() => useAnomalies());
    const fetcher = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(fetcher('/x')).rejects.toThrow('Failed to fetch anomalies');
  });

  it('dismiss optimistically removes the row, then POSTs and revalidates', async () => {
    stubSwr({ data: [] });
    mockFetchFn.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useAnomalies());
    await act(async () => {
      await result.current.dismiss('a1');
    });

    // Optimistic update: first mutate call gets an updater fn + revalidate:false.
    const [updater, opts] = mockMutate.mock.calls[0];
    expect(opts).toEqual({ revalidate: false });
    const rows = [{ id: 'a1' }, { id: 'a2' }] as AnomalyRow[];
    expect((updater as (r: AnomalyRow[]) => AnomalyRow[])(rows)).toEqual([
      { id: 'a2' },
    ]);

    // POST to the dismiss route.
    expect(mockFetchFn).toHaveBeenCalledWith('/analytics/v2/anomalies/a1/dismiss', {
      method: 'POST',
    });
    // Final revalidate (mutate with no args).
    expect(mockMutate).toHaveBeenLastCalledWith();
  });
});
