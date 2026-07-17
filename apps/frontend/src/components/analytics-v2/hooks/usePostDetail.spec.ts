import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockFetchFn = vi.fn();
const mockMutate = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('swr', () => ({
  default: vi.fn(),
}));

import useSWR from 'swr';
import { usePostDetail } from './usePostDetail';

const mockUseSWR = vi.mocked(useSWR);

describe('usePostDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stubSwr(overrides: {
    data?: any;
    error?: any;
    isLoading?: boolean;
    isValidating?: boolean;
  }) {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
      ...overrides,
    } as any);
  }

  it('does not fetch when postId is empty string', () => {
    stubSwr({});

    const { result } = renderHook(() => usePostDetail(''));

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('serializes SWR key with the postId', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePostDetail('post-456'));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toBe('/analytics/v2/post/post-456');
  });

  it('passes the fetcher as second argument to useSWR', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePostDetail('post-456'));

    expect(typeof mockUseSWR.mock.calls[0][1]).toBe('function');
  });

  it('passes swr config as third argument', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePostDetail('post-456'));

    const config = mockUseSWR.mock.calls[0][2];
    expect(config).toMatchObject({
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    });
  });

  it('returns loading state from useSWR', () => {
    stubSwr({ isLoading: true });

    const { result } = renderHook(() => usePostDetail('post-456'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns data state from useSWR', () => {
    const mockData = {
      postId: 'post-456',
      content: 'Hello',
      integration: { id: '', name: '', identifier: '', picture: '' },
      publishedAt: '2024-01-01',
      metrics: {},
      series: {},
    };
    stubSwr({ data: mockData });

    const { result } = renderHook(() => usePostDetail('post-456'));

    expect(result.current.data).toBe(mockData);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns error state from useSWR', () => {
    const mockError = new Error('Failed to fetch post detail');
    stubSwr({ error: mockError });

    const { result } = renderHook(() => usePostDetail('post-456'));

    expect(result.current.error).toBe(mockError);
    expect(result.current.isLoading).toBe(false);
  });

  it('fetcher calls fetch with path and returns json on ok', async () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePostDetail('post-456'));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    const mockData = { postId: 'post-456', content: 'Hello' };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => mockData });

    const result = await fetcher('/analytics/v2/post/post-456');

    expect(mockFetchFn).toHaveBeenCalledWith('/analytics/v2/post/post-456');
    expect(result).toBe(mockData);
  });

  it('fetcher throws on non-ok response', async () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePostDetail('post-456'));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/analytics/v2/post/post-456')).rejects.toThrow('Failed to fetch post detail');
  });
});
