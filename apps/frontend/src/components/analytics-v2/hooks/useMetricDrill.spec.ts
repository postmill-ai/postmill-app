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
import { useMetricDrill } from './useMetricDrill';

const mockUseSWR = vi.mocked(useSWR);

describe('useMetricDrill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const params = {
    metric: 'impressions',
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

  it('serializes SWR key with encoded metric and query params', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useMetricDrill(params));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/metric/impressions?');
    expect(key).toContain('from=2024-01-01');
    expect(key).toContain('to=2024-01-07');
    expect(key).toContain('integrations=i1%2Ci2');
    expect(key).toContain('compare=true');
  });

  it('appends campaigns to the key when present, and omits it when absent (1.6)', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useMetricDrill({ ...params, campaigns: ['c1', 'c2'] }));
    expect(mockUseSWR.mock.calls[0][0] as string).toContain(
      'campaigns=c1%2Cc2'
    );

    renderHook(() => useMetricDrill(params));
    expect(mockUseSWR.mock.calls[1][0] as string).not.toContain('campaigns=');
  });

  it('does not fetch when metric is empty string', () => {
    stubSwr({});

    const { result } = renderHook(() =>
      useMetricDrill({ ...params, metric: '' })
    );

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('serializes compare=false correctly', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useMetricDrill({ ...params, compare: false }));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('compare=false');
  });

  it('returns loading state from useSWR', () => {
    stubSwr({ isLoading: true });

    const { result } = renderHook(() => useMetricDrill(params));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns data state from useSWR', () => {
    const mockData = {
      metric: 'impressions',
      label: 'Impressions',
      total: 1000,
    };
    stubSwr({ data: mockData });

    const { result } = renderHook(() => useMetricDrill(params));

    expect(result.current.data).toBe(mockData);
  });

  it('returns error state from useSWR', () => {
    const mockError = new Error('Failed to fetch metric drill');
    stubSwr({ error: mockError });

    const { result } = renderHook(() => useMetricDrill(params));

    expect(result.current.error).toBe(mockError);
  });

  it('fetcher calls fetch with path and returns json on ok', async () => {
    renderHook(() => useMetricDrill(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    const mockData = { metric: 'impressions', label: 'Impressions' };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => mockData });

    const result = await fetcher('/some-path');
    expect(mockFetchFn).toHaveBeenCalledWith('/some-path');
    expect(result).toBe(mockData);
  });

  it('fetcher throws on non-ok response', async () => {
    renderHook(() => useMetricDrill(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/some-path')).rejects.toThrow('Failed to fetch metric drill');
  });
});
