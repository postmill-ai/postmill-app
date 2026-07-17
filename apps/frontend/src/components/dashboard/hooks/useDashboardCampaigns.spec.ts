import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardCampaigns, CampaignSummary } from './useDashboardCampaigns';

const { fetchMock, useSWRMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  useSWRMock: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: useSWRMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const makeCampaign = (id: string): CampaignSummary => ({
  id,
  name: `Campaign ${id}`,
  endDate: null,
  postCounts: { queue: 1, published: 2, draft: 3, error: 4 },
  goals: [{ metric: 'engagement', target: 100, current: 50, pct: 0.5 }],
});

describe('useDashboardCampaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a loading state from useSWR', () => {
    useSWRMock.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useDashboardCampaigns());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns data state with campaign summaries', () => {
    const data = [makeCampaign('1'), makeCampaign('2')];
    useSWRMock.mockReturnValue({
      data,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useDashboardCampaigns());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Campaign 1');
    expect(result.current.data?.[1].postCounts.published).toBe(2);
  });

  it('returns an empty data array when there are no campaigns', () => {
    useSWRMock.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useDashboardCampaigns());

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('configures useSWR with the correct key, fetcher and options', () => {
    useSWRMock.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    renderHook(() => useDashboardCampaigns(10));

    expect(useSWRMock).toHaveBeenCalledTimes(1);
    const [key, fetcher, options] = useSWRMock.mock.calls[0];
    expect(key).toBe('/dashboard/campaigns?limit=10');
    expect(typeof fetcher).toBe('function');
    expect(options).toMatchObject({
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
  });

  it('fetcher calls the API and parses the JSON response', async () => {
    const payload: CampaignSummary[] = [makeCampaign('a')];
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });

    useSWRMock.mockImplementation((key, fetcher) => {
      fetcher(key);
      return { data: payload, error: undefined, isLoading: false, mutate: vi.fn() };
    });

    renderHook(() => useDashboardCampaigns());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/dashboard/campaigns?limit=6')
    );

    const res = await fetchMock.mock.results[0].value;
    expect(await res.json()).toEqual(payload);
  });

  it('fetcher throws when the API response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    useSWRMock.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    renderHook(() => useDashboardCampaigns());

    const [, fetcher] = useSWRMock.mock.lastCall as [
      string,
      (url: string) => Promise<CampaignSummary[]>,
    ];

    await expect(fetcher('/dashboard/campaigns?limit=6')).rejects.toThrow(
      'Failed to load campaigns'
    );
  });
});
