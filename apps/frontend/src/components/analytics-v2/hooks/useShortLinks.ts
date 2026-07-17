'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { createFetchError } from '../utils';

interface ShortLinkStat {
  id: string;
  shortUrl: string;
  originalUrl: string;
  provider: string;
  clicks: number;
  createdAt: string;
}

interface TimeseriesPoint {
  date: string;
  clicks: number;
}

export const useShortLinks = (from?: string, to?: string) => {
  const fetch = useFetch();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const load = useCallback(async () => {
    const res = await fetch(`/analytics/v2/shortlinks${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw createFetchError('short_links_fetch_failed', 'Failed to load short links');
    return res.json();
  }, [fetch, qs]);

  return useSWR<ShortLinkStat[]>(`shortlinks-${qs}`, load, {
    revalidateOnFocus: false,
  });
};

export const useShortLinksTimeseries = (from?: string, to?: string) => {
  const fetch = useFetch();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  const load = useCallback(async () => {
    const res = await fetch(`/analytics/v2/shortlinks/timeseries${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw createFetchError('short_links_timeseries_fetch_failed', 'Failed to load short link timeseries');
    return res.json();
  }, [fetch, qs]);

  return useSWR<TimeseriesPoint[]>(`shortlinks-timeseries-${qs}`, load, {
    revalidateOnFocus: false,
  });
};
