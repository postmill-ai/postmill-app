import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { usePostShortlinkStats } from './usePostShortlinkStats';

const mockUseSWR = vi.mocked(useSWR);

describe('usePostShortlinkStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: false } as any);
  });

  it('reads the per-post statistics resource', () => {
    renderHook(() => usePostShortlinkStats('post-1'));
    expect(mockUseSWR.mock.calls[0][0]).toBe('/posts/post-1/statistics');
  });

  it('passes a null key when postId is empty', () => {
    renderHook(() => usePostShortlinkStats(''));
    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
  });

  it('load fetcher returns json on success', async () => {
    renderHook(() => usePostShortlinkStats('post-1'));
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    const payload = { clicks: [{ short: 's', original: 'o', clicks: 3 }] };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(payload) });
    await expect(load('/posts/post-1/statistics')).resolves.toEqual(payload);
    expect(mockFetchFn).toHaveBeenCalledWith('/posts/post-1/statistics');
  });

  it('load fetcher throws on failure', async () => {
    renderHook(() => usePostShortlinkStats('post-1'));
    const load = mockUseSWR.mock.calls[0][1] as (p: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });
    await expect(load('/x')).rejects.toThrow('Failed to fetch short-link statistics');
  });
});
