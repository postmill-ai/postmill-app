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
import { useDayDrill } from './useDayDrill';

const mockUseSWR = vi.mocked(useSWR);

describe('useDayDrill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const params = {
    date: '2024-01-15',
    metric: 'impressions',
    integrations: ['i1', 'i2'],
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

  it('serializes SWR key with date, metric, and integrations', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useDayDrill(params));

    const key = mockUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('/analytics/v2/day?');
    expect(key).toContain('date=2024-01-15');
    expect(key).toContain('metric=impressions');
    expect(key).toContain('integrations=i1%2Ci2');
  });

  it('appends campaigns to the key when present, and omits it when absent (1.6)', () => {
    stubSwr({ isLoading: true });

    renderHook(() => useDayDrill({ ...params, campaigns: ['c1', 'c2'] }));
    expect(mockUseSWR.mock.calls[0][0] as string).toContain(
      'campaigns=c1%2Cc2'
    );

    renderHook(() => useDayDrill(params));
    expect(mockUseSWR.mock.calls[1][0] as string).not.toContain('campaigns=');
  });

  it('returns empty (not loading) when date is empty string', () => {
    stubSwr({});

    const { result } = renderHook(() =>
      useDayDrill({ ...params, date: '' })
    );

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('returns empty (not loading) when metric is empty string', () => {
    stubSwr({});

    const { result } = renderHook(() =>
      useDayDrill({ ...params, metric: '' })
    );

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('returns empty (not loading) when both date and metric are empty', () => {
    stubSwr({});

    const { result } = renderHook(() =>
      useDayDrill({ ...params, date: '', metric: '' })
    );

    expect(mockUseSWR.mock.calls[0][0]).toBeNull();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('fetches when date and metric are both provided', () => {
    stubSwr({ isLoading: true });

    const { result } = renderHook(() => useDayDrill(params));

    expect(mockUseSWR.mock.calls[0][0]).not.toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data state from useSWR', () => {
    const mockData = {
      date: '2024-01-15',
      metric: 'impressions',
      value: 500,
    };
    stubSwr({ data: mockData });

    const { result } = renderHook(() => useDayDrill(params));

    expect(result.current.data).toBe(mockData);
  });

  it('returns error state from useSWR', () => {
    const mockError = new Error('Failed to fetch day drill');
    stubSwr({ error: mockError });

    const { result } = renderHook(() => useDayDrill(params));

    expect(result.current.error).toBe(mockError);
  });

  it('fetcher calls fetch with path and returns json on ok', async () => {
    renderHook(() => useDayDrill(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    const mockData = { date: '2024-01-15', metric: 'impressions', value: 500 };
    mockFetchFn.mockResolvedValueOnce({ ok: true, json: async () => mockData });

    const result = await fetcher('/some-path');
    expect(mockFetchFn).toHaveBeenCalledWith('/some-path');
    expect(result).toBe(mockData);
  });

  it('fetcher throws on non-ok response', async () => {
    renderHook(() => useDayDrill(params));

    const fetcher = mockUseSWR.mock.calls[0][1] as (path: string) => Promise<any>;
    mockFetchFn.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/some-path')).rejects.toThrow('Failed to fetch day drill');
  });
});
