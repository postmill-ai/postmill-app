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
import { useChannelDetail } from './useChannelDetail';

const mockUseSWR = vi.mocked(useSWR);

describe('useChannelDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const params = {
    integrationId: 'int-123',
    from: '2024-01-01',
    to: '2024-01-07',
    compare: true,
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

  it('serializes SWR key with integrationId and query params', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useChannelDetail(params));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/channel/int-123?');
    expect(key).toContain('from=2024-01-01');
    expect(key).toContain('to=2024-01-07');
    expect(key).toContain('compare=true');
  });

  it('does not fetch when integrationId is empty string', () => {
    stubSwr({});

    const { result } = renderHook(() =>
      useChannelDetail({ ...params, integrationId: '' })
    );

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('url-encodes the integrationId', () => {
    stubSwr({ isLoading: true });

    renderHook(() =>
      useChannelDetail({ ...params, integrationId: 'my channel/1' })
    );

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/channel/my%20channel%2F1?');
  });

  it('serializes compare=false correctly', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useChannelDetail({ ...params, compare: false }));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('compare=false');
  });

  it('passes the fetcher as second argument to useSWR', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useChannelDetail(params));

    expect(typeof mockUseSWR.mock.calls[0][1]).toBe('function');
  });

  it('passes swr config as third argument', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useChannelDetail(params));

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

    const { result } = renderHook(() => useChannelDetail(params));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns data state from useSWR', () => {
    const mockData = {
      kpis: [],
      series: {},
      topPosts: [],
    };
    stubSwr({ data: mockData });

    const { result } = renderHook(() => useChannelDetail(params));

    expect(result.current.data).toBe(mockData);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns error state from useSWR', () => {
    const mockError = new Error('Failed to fetch channel detail');
    stubSwr({ error: mockError });

    const { result } = renderHook(() => useChannelDetail(params));

    expect(result.current.error).toBe(mockError);
    expect(result.current.isLoading).toBe(false);
  });

  it('fetcher calls fetch with path and returns json on ok', async () => {
    stubSwr({ isLoading: true });

    renderHook(() => useChannelDetail(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    const mockData = { kpis: [], series: {}, topPosts: [] };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => mockData });

    const result = await fetcher('/analytics/v2/channel/int-123?from=2024-01-01&to=2024-01-07&compare=true');

    expect(mockFetchFn).toHaveBeenCalledWith('/analytics/v2/channel/int-123?from=2024-01-01&to=2024-01-07&compare=true');
    expect(result).toBe(mockData);
  });

  it('fetcher throws on non-ok response', async () => {
    stubSwr({ isLoading: true });

    renderHook(() => useChannelDetail(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/some-path')).rejects.toThrow('Failed to fetch channel detail');
  });
});
