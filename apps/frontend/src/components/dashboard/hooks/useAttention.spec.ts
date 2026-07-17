import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockFetch = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('swr', () => ({
  default: vi.fn(),
  mutate: vi.fn(),
}));

import useSWR, { mutate } from 'swr';
import { useAttention } from './useAttention';

const mockGlobalMutate = vi.mocked(mutate);

const mockUseSWR = vi.mocked(useSWR);

describe('useAttention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    } as any);
  });

  it('returns loading state by default', () => {
    const { result } = renderHook(() => useAttention());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.retryPost).toBeTypeOf('function');
    expect(result.current.dismissAnomaly).toBeTypeOf('function');
  });

  it('fetches /dashboard/attention with refreshInterval 60_000', () => {
    renderHook(() => useAttention());

    expect(mockUseSWR.mock.calls[0][0]).toBe('/dashboard/attention');
    const options = mockUseSWR.mock.calls[0][2] as any;
    expect(options.refreshInterval).toBe(60_000);
    expect(options.revalidateOnFocus).toBe(false);
    expect(options.revalidateOnReconnect).toBe(false);
  });

  it('loads attention data on fetch success', async () => {
    renderHook(() => useAttention());
    const fetcher = mockUseSWR.mock.calls[0][1] as (url: string) => Promise<any>;

    const payload = {
      items: [
        { id: '1', kind: 'failed-posts', severity: 'critical', title: 'Failed posts', count: 2, link: '/posts' },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce(payload),
    });

    const data = await fetcher('/dashboard/attention');

    expect(mockFetch).toHaveBeenCalledWith('/dashboard/attention');
    expect(data).toEqual(payload);
  });

  it('throws when attention fetch fails', async () => {
    renderHook(() => useAttention());
    const fetcher = mockUseSWR.mock.calls[0][1] as (url: string) => Promise<any>;

    mockFetch.mockResolvedValueOnce({ ok: false });

    await expect(fetcher('/dashboard/attention')).rejects.toThrow('Failed to load attention');
  });

  it('retryPost POSTs /posts/:id/retry and revalidates on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const mutate = vi.fn();
    mockUseSWR.mockReturnValue({ data: { items: [] }, isLoading: false, mutate } as any);

    const { result } = renderHook(() => useAttention());

    await act(async () => {
      await result.current.retryPost('post-123');
    });

    expect(mockFetch).toHaveBeenCalledWith('/posts/post-123/retry', { method: 'POST' });
    expect(mutate).toHaveBeenCalled();
    expect(mockGlobalMutate).toHaveBeenCalledWith('/dashboard/summary');
  });

  it('retryPost surfaces backend message on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValueOnce({ message: 'Not in ERROR state' }),
    });
    mockUseSWR.mockReturnValue({ data: { items: [] }, isLoading: false, mutate: vi.fn() } as any);

    const { result } = renderHook(() => useAttention());

    await expect(result.current.retryPost('post-123')).rejects.toThrow('Not in ERROR state');
  });

  it('dismissAnomaly POSTs /analytics/v2/anomalies/:id/dismiss and revalidates', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const mutate = vi.fn();
    mockUseSWR.mockReturnValue({ data: { items: [] }, isLoading: false, mutate } as any);

    const { result } = renderHook(() => useAttention());

    await act(async () => {
      await result.current.dismissAnomaly('anomaly-1');
    });

    expect(mockFetch).toHaveBeenCalledWith('/analytics/v2/anomalies/anomaly-1/dismiss', {
      method: 'POST',
    });
    expect(mutate).toHaveBeenCalled();
  });
});
