'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { DayDetailResponse, createFetchError } from '../utils';

interface DayDrillParams {
  date: string;
  metric: string;
  integrations: string[];
  /** Campaign filter (1.6) — server-scopes the day drill to these campaigns' posts. */
  campaigns?: string[];
}

function serializeParams(p: DayDrillParams): string {
  const params = new URLSearchParams({
    date: p.date,
    metric: p.metric,
    integrations: p.integrations.join(','),
  });
  if (p.campaigns?.length) {
    params.set('campaigns', p.campaigns.join(','));
  }
  return `/analytics/v2/day?${params.toString()}`;
}

export const useDayDrill = (params: DayDrillParams) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('day_drill_fetch_failed', 'Failed to fetch day drill');
    return res.json() as Promise<DayDetailResponse>;
  }, [fetch]);

  const key = serializeParams(params);

  return useSWR(params.date && params.metric ? key : null, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
