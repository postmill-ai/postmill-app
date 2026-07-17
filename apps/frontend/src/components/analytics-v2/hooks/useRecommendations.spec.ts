import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useRecommendations } from './useRecommendations';

const mockUseSWR = vi.mocked(useSWR);

describe('useRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('keys SWR by the recommendations endpoint', () => {
    renderHook(() => useRecommendations());
    expect(mockUseSWR.mock.calls[0][0]).toBe('/analytics/v2/recommendations');
  });

  it('load fetcher returns parsed recommendations and throws on failure', async () => {
    renderHook(() => useRecommendations());
    const load = mockUseSWR.mock.calls[0][1] as () => Promise<any>;

    mockFetchFn.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ recommendations: [{ title: 'x' }] }),
    });
    expect(await load()).toEqual({ recommendations: [{ title: 'x' }] });
    expect(mockFetchFn.mock.calls[0][0]).toBe('/analytics/v2/recommendations');

    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(load()).rejects.toThrow('Failed to fetch recommendations');
  });
});
