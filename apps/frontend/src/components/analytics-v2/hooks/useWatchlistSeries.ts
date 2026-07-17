'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

export interface WatchlistSeriesPoint {
  date: string;
  value: number;
}

// GET /analytics/v2/watchlist/:id/series (6.3) — the watched competitor's metric
// series alongside your own channels' same metric, for the overlay chart.
export interface WatchlistSeriesResponse {
  watched: WatchlistSeriesPoint[];
  own: WatchlistSeriesPoint[];
}

/**
 * Competitor-overlay series for one watched account (6.3). Fetches only when
 * `id` is set (the tab passes an empty id to disable). One SWR hook per
 * resource; the key encodes the metric + range so it revalidates on change.
 */
export const useWatchlistSeries = (
  id: string | undefined,
  metric = 'followers',
  from?: string,
  to?: string
) => {
  const fetch = useFetch();

  const params = new URLSearchParams({ metric });
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const key = id ? `/analytics/v2/watchlist/${id}/series?${params.toString()}` : null;

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw createFetchError('watchlist_series_fetch_failed', 'Failed to load watchlist series');
      return res.json() as Promise<WatchlistSeriesResponse>;
    },
    [fetch]
  );

  return useSWR<WatchlistSeriesResponse>(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};
