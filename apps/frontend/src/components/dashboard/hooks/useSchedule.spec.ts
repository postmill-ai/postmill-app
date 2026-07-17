import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useSchedule, ScheduleResponse } from './useSchedule';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(() => vi.fn()),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  getTimezone: () => 'America/New_York',
}));

const mockedUseSWR = vi.mocked(useSWR);
const mockedUseFetch = vi.mocked(useFetch);

describe('useSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sample: ScheduleResponse = {
    days: [
      { date: '2026-07-06', count: 3 },
      { date: '2026-07-07', count: 0 },
    ],
    gaps: ['2026-07-08'],
  };

  it('returns a loading state before data resolves', () => {
    mockedUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    } as any);

    const { result } = renderHook(() => useSchedule());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('returns the schedule data and exposes expected values', () => {
    mockedUseSWR.mockReturnValue({
      data: sample,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    const { result } = renderHook(() => useSchedule());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual(sample);
    expect(result.current.data?.days).toHaveLength(2);
    expect(result.current.data?.gaps).toContain('2026-07-08');
  });

  it('returns an empty schedule when the response contains no data', () => {
    const empty: ScheduleResponse = { days: [], gaps: [] };

    mockedUseSWR.mockReturnValue({
      data: empty,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    const { result } = renderHook(() => useSchedule());

    expect(result.current.data?.days).toHaveLength(0);
    expect(result.current.data?.gaps).toHaveLength(0);
  });

  it('passes days and timezone to the SWR key', () => {
    mockedUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    } as any);

    renderHook(() => useSchedule(14));

    expect(mockedUseSWR).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/schedule?days=14&timezone='),
      expect.any(Function),
      expect.objectContaining({
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      })
    );

    const key = mockedUseSWR.mock.calls[0][0] as string;
    expect(key).toContain('timezone=America%2FNew_York');
  });

  it('fetcher throws when the underlying response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    mockedUseFetch.mockReturnValue(fetchMock);

    let capturedFetcher: ((url: string) => Promise<ScheduleResponse>) | undefined;
    mockedUseSWR.mockImplementation(((_key, fetcher, _options) => {
      capturedFetcher = fetcher as any;
      return { data: undefined, error: undefined, isLoading: true, mutate: vi.fn() } as any;
    }) as any);

    renderHook(() => useSchedule());

    expect(capturedFetcher).toBeDefined();
    await expect(capturedFetcher!('/dashboard/schedule?days=7')).rejects.toThrow(
      'Failed to load schedule'
    );
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/schedule?days=7');
  });
});
