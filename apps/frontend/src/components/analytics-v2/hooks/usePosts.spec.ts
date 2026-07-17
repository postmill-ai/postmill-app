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
import { usePosts } from './usePosts';

const mockUseSWR = vi.mocked(useSWR);

describe('usePosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fullParams = {
    from: '2024-01-01',
    to: '2024-01-07',
    integrations: ['i1', 'i2'],
    sort: 'impressions',
    dir: 'desc' as const,
    page: 2,
    limit: 10,
  };

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

  it('returns empty data (not loading, not error) when params is undefined', () => {
    stubSwr({});

    const { result } = renderHook(() => usePosts(undefined));

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('serializes SWR key with sort/dir/page/limit', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePosts(fullParams));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/posts?');
    expect(key).toContain('from=2024-01-01');
    expect(key).toContain('to=2024-01-07');
    expect(key).toContain('integrations=i1%2Ci2');
    expect(key).toContain('sort=impressions');
    expect(key).toContain('dir=desc');
    expect(key).toContain('page=2');
    expect(key).toContain('limit=10');
  });

  it('appends campaigns to the key when present, and omits it when absent (1.6)', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePosts({ ...fullParams, campaigns: ['c1', 'c2'] }));
    expect(mockUseSWR.mock.calls[0][0] as string).toContain(
      'campaigns=c1%2Cc2'
    );

    renderHook(() => usePosts(fullParams));
    expect(mockUseSWR.mock.calls[1][0] as string).not.toContain('campaigns=');
  });

  it('serializes asc direction correctly', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePosts({ ...fullParams, dir: 'asc' }));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('dir=asc');
  });

  it('serializes first page with default limit', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePosts({ ...fullParams, page: 1, limit: 25 }));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('page=1');
    expect(key).toContain('limit=25');
  });

  it('passes swr config options', () => {
    stubSwr({ isLoading: true });

    renderHook(() => usePosts(fullParams));

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

    const { result } = renderHook(() => usePosts(fullParams));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns data state from useSWR', () => {
    const mockData = { posts: [], total: 0 };
    stubSwr({ data: mockData });

    const { result } = renderHook(() => usePosts(fullParams));

    expect(result.current.data).toBe(mockData);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns error state from useSWR', () => {
    const mockError = new Error('Failed to fetch posts');
    stubSwr({ error: mockError });

    const { result } = renderHook(() => usePosts(fullParams));

    expect(result.current.error).toBe(mockError);
  });

  it('fetcher calls fetch with path and returns json on ok', async () => {
    renderHook(() => usePosts(fullParams));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    const mockData = { posts: [], total: 0 };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => mockData });

    const result = await fetcher('/some-path');
    expect(mockFetchFn).toHaveBeenCalledWith('/some-path');
    expect(result).toBe(mockData);
  });

  it('fetcher throws on non-ok response', async () => {
    renderHook(() => usePosts(fullParams));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/some-path')).rejects.toThrow('Failed to fetch posts');
  });
});
