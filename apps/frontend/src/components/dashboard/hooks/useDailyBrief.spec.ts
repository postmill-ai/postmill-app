import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockFetch = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('swr', () => ({ default: vi.fn() }));

import useSWR from 'swr';
import { useDailyBrief } from './useDailyBrief';

const mockUseSWR = vi.mocked(useSWR);

describe('useDailyBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    } as any);
  });

  it('subscribes to /dashboard/brief with revalidation off', () => {
    renderHook(() => useDailyBrief());

    expect(mockUseSWR.mock.calls[0][0]).toBe('/dashboard/brief');
    const options = mockUseSWR.mock.calls[0][2] as any;
    expect(options.revalidateOnFocus).toBe(false);
    expect(options.revalidateOnReconnect).toBe(false);
  });

  it('returns loading state by default', () => {
    const { result } = renderHook(() => useDailyBrief());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.generate).toBeTypeOf('function');
  });

  it('loads cached brief data', async () => {
    renderHook(() => useDailyBrief());
    const fetcher = mockUseSWR.mock.calls[0][1] as (url: string) => Promise<any>;

    const payload = { brief: 'Your day looks clear.', generatedAt: '2026-01-01T00:00:00Z' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce(payload),
    });

    const data = await fetcher('/dashboard/brief');
    expect(data).toEqual(payload);
  });

  it('generate POSTs /dashboard/brief and mutates SWR data on success', async () => {
    const mutate = vi.fn();
    mockUseSWR.mockReturnValue({ data: { cached: false }, isLoading: false, mutate } as any);

    const payload = { brief: 'Generated.', generatedAt: '2026-01-01T00:00:00Z' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValueOnce(payload),
    });

    const { result } = renderHook(() => useDailyBrief());

    const data = await act(() => result.current.generate());

    expect(mockFetch).toHaveBeenCalledWith('/dashboard/brief', { method: 'POST' });
    expect(mutate).toHaveBeenCalledWith(payload, false);
    expect(data).toEqual(payload);
  });

  it('generate throws with status on non-ok response', async () => {
    mockUseSWR.mockReturnValue({ data: { cached: false }, isLoading: false, mutate: vi.fn() } as any);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValueOnce({ message: 'AI not configured' }),
    });

    const { result } = renderHook(() => useDailyBrief());

    await expect(result.current.generate()).rejects.toThrow('AI not configured');
  });
});
