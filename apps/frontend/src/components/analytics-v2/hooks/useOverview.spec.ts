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
import { useOverview } from './useOverview';

const mockUseSWR = vi.mocked(useSWR);

describe('useOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const params = {
    from: '2024-01-01',
    to: '2024-01-07',
    integrations: ['i1', 'i2'],
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

  it('serializes the SWR key with from/to/integrations/compare', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useOverview(params));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/overview?');
    expect(key).toContain('from=2024-01-01');
    expect(key).toContain('to=2024-01-07');
    expect(key).toContain('integrations=i1%2Ci2');
    expect(key).toContain('compare=true');
  });

  it('serializes compare=false correctly', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useOverview({ ...params, compare: false }));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('compare=false');
  });

  it('url-encodes integration commas', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useOverview({ ...params, integrations: ['a', 'b', 'c'] }));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('integrations=a%2Cb%2Cc');
  });

  it('appends campaigns to the key when present, and omits it when absent (1.6)', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useOverview({ ...params, campaigns: ['c1', 'c2'] }));
    expect(mockUseSWR.mock.calls[0][0] as string).toContain(
      'campaigns=c1%2Cc2'
    );

    renderHook(() => useOverview(params));
    expect(mockUseSWR.mock.calls[1][0] as string).not.toContain('campaigns=');
  });

  it('passes the fetcher as second argument to useSWR', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useOverview(params));

    expect(typeof mockUseSWR.mock.calls[0][1]).toBe('function');
  });

  it('passes swr config as third argument', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useOverview(params));

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

    const { result } = renderHook(() => useOverview(params));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('returns data state from useSWR', () => {
    const mockData = {
      range: { from: '2024-01-01', to: '2024-01-07' },
      kpis: [],
      series: {},
      byChannel: [],
      breakdown: { byPlatform: [] },
    };
    stubSwr({ data: mockData });

    const { result } = renderHook(() => useOverview(params));

    expect(result.current.data).toBe(mockData);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('returns error state from useSWR', () => {
    const mockError = new Error('Failed to fetch overview');
    stubSwr({ error: mockError });

    const { result } = renderHook(() => useOverview(params));

    expect(result.current.error).toBe(mockError);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('fetcher calls fetch with path and returns json on ok', async () => {
    renderHook(() => useOverview(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    const mockData = { range: { from: '2024-01-01', to: '2024-01-07' }, kpis: [], series: {}, byChannel: [], breakdown: { byPlatform: [] } };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => mockData });

    const result = await fetcher('/some-path');
    expect(mockFetchFn).toHaveBeenCalledWith('/some-path');
    expect(result).toBe(mockData);
  });

  it('fetcher throws on non-ok response', async () => {
    renderHook(() => useOverview(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/some-path')).rejects.toThrow('Failed to fetch overview');
  });
});
