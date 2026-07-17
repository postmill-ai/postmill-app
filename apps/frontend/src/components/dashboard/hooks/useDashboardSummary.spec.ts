import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useDashboardSummary, DashboardSummary } from './useDashboardSummary';

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
}));

describe('useDashboardSummary', () => {
  const fetchMock = vi.fn();
  const mutateMock = vi.fn();

  const summary: DashboardSummary = {
    totalPosts: 12,
    scheduledPosts: 3,
    publishedNext7: 5,
    channelsConnected: 2,
    drafts: 2,
    upcomingPosts: [
      {
        id: 'post-1',
        content: 'Hello world',
        publishDate: '2026-06-11T10:00:00.000Z',
        channelName: 'My X',
        providerIdentifier: 'x',
      },
    ],
    commentUnreadCount: 4,
    aiProviderActive: true,
    mediaProviderActive: true,
    storageProviderActive: false,
    teamMembers: 3,
  };

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
    const { result } = renderHook(() => useDashboardSummary());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.mutate).toBe(mutateMock);
  });

  it('returns summary data when loaded', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: summary,
      error: undefined,
      isLoading: false,
      mutate: mutateMock,
    });

    const { result } = renderHook(() => useDashboardSummary());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(summary);
    expect(result.current.error).toBeUndefined();
  });

  it('configures SWR with revalidation disabled', () => {
    renderHook(() => useDashboardSummary());
    const [key, , options] = (useSWR as unknown as ReturnType<typeof vi.fn>).mock
      .lastCall as [
      string,
      unknown,
      { revalidateOnFocus: boolean; revalidateOnReconnect: boolean }
    ];
    expect(key).toBe('/dashboard/summary');
    expect(options.revalidateOnFocus).toBe(false);
    expect(options.revalidateOnReconnect).toBe(false);
  });

  it('load function throws when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    renderHook(() => useDashboardSummary());
    const [, load] = (useSWR as unknown as ReturnType<typeof vi.fn>).mock
      .lastCall as [string, (url: string) => Promise<unknown>];
    await expect(load('/dashboard/summary')).rejects.toThrow(
      'Failed to load summary'
    );
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/summary');
  });

  it('load function returns parsed JSON on ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(summary),
    });
    renderHook(() => useDashboardSummary());
    const [, load] = (useSWR as unknown as ReturnType<typeof vi.fn>).mock
      .lastCall as [string, (url: string) => Promise<unknown>];
    await expect(load('/dashboard/summary')).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/summary');
  });
});
