import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUsage } from './useUsage';

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
}));

describe('useUsage', () => {
  const fetchMock = vi.fn();
  const mutateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    mutateMock.mockReset();
    (useFetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fetchMock);
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: mutateMock,
    });
  });

  it('returns loading state before data resolves', () => {
    const { result } = renderHook(() => useUsage());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.mutate).toBe(mutateMock);
  });

  it('returns usage data when loaded', () => {
    const data = {
      billingEnabled: true,
      tier: 'pro',
      limits: { postsPerMonth: 100, channels: 10, teamMembers: 5 },
      usage: { postsThisCycle: 42, channels: 3, teamMembers: 2 },
    };
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data,
      error: undefined,
      isLoading: false,
      mutate: mutateMock,
    });

    const { result } = renderHook(() => useUsage());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(data);
    expect(result.current.error).toBeUndefined();
  });

  it('returns the no-billing empty state', () => {
    const data = { billingEnabled: false };
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data,
      error: undefined,
      isLoading: false,
      mutate: mutateMock,
    });

    const { result } = renderHook(() => useUsage());
    expect(result.current.data).toEqual(data);
    expect(result.current.data?.billingEnabled).toBe(false);
  });

  it('configures SWR with revalidation disabled', () => {
    renderHook(() => useUsage());
    const [, , options] = (useSWR as unknown as ReturnType<typeof vi.fn>).mock
      .lastCall as [
      string,
      unknown,
      { revalidateOnFocus: boolean; revalidateOnReconnect: boolean }
    ];
    expect(options.revalidateOnFocus).toBe(false);
    expect(options.revalidateOnReconnect).toBe(false);
  });

  it('load function throws when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    renderHook(() => useUsage());
    const [, load] = (useSWR as unknown as ReturnType<typeof vi.fn>).mock
      .lastCall as [string, (url: string) => Promise<unknown>];
    await expect(load('/dashboard/usage')).rejects.toThrow(
      'Failed to load usage'
    );
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/usage');
  });

  it('load function returns parsed JSON on ok response', async () => {
    const payload = { billingEnabled: true, tier: 'team' };
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    renderHook(() => useUsage());
    const [, load] = (useSWR as unknown as ReturnType<typeof vi.fn>).mock
      .lastCall as [string, (url: string) => Promise<unknown>];
    await expect(load('/dashboard/usage')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/usage');
  });
});
