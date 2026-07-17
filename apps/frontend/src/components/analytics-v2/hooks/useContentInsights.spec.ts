import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useContentInsights } from './useContentInsights';

const mockUseSWR = vi.mocked(useSWR);

describe('useContentInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('reads the content-insights resource', () => {
    renderHook(() => useContentInsights());
    expect(mockUseSWR.mock.calls[0][0]).toBe('/analytics/v2/content-insights');
  });

  it('load fetcher throws on failure', async () => {
    renderHook(() => useContentInsights());
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(load('/x')).rejects.toThrow('Failed to load content insights');
  });
});
