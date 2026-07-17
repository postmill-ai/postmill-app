import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetch = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useShortLinks', () => {
  it('returns data from the SWR hook', async () => {
    const { useShortLinks } = await import('./useShortLinks');

    const mockData = [
      { id: '1', shortUrl: 'https://short.ly/a', originalUrl: 'https://example.com/1', provider: 'bitly', clicks: 42, createdAt: '2026-01-01' },
      { id: '2', shortUrl: 'https://short.ly/b', originalUrl: 'https://example.com/2', provider: 'bitly', clicks: 7, createdAt: '2026-01-02' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useShortLinks('2026-01-01', '2026-01-31'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });
  });

  it('handles fetch error', async () => {
    const { useShortLinks } = await import('./useShortLinks');

    mockFetch.mockResolvedValueOnce({
      ok: false,
    });

    const { result } = renderHook(() => useShortLinks(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });
});

describe('useShortLinksTimeseries', () => {
  it('returns timeseries data from the SWR hook', async () => {
    const { useShortLinksTimeseries } = await import('./useShortLinks');

    const mockData = [
      { date: '2026-01-01', clicks: 10 },
      { date: '2026-01-02', clicks: 15 },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useShortLinksTimeseries('2026-01-01', '2026-01-31'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });
  });
});
