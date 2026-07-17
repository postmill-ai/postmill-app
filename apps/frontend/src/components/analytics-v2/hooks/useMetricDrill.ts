'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { MetricDetailResponse, createFetchError } from '../utils';

interface MetricDrillParams {
  metric: string;
  from: string;
  to: string;
  integrations: string[];
  compare: boolean;
  /** Campaign filter (1.6) — server-scopes the drill to these campaigns' posts. */
  campaigns?: string[];
}

function serializeParams(p: MetricDrillParams): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    integrations: p.integrations.join(','),
    compare: String(p.compare),
  });
  if (p.campaigns?.length) {
    params.set('campaigns', p.campaigns.join(','));
  }
  return `/analytics/v2/metric/${encodeURIComponent(p.metric)}?${params.toString()}`;
}

export const useMetricDrill = (params: MetricDrillParams) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('metric_drill_fetch_failed', 'Failed to fetch metric drill');
    return res.json() as Promise<MetricDetailResponse>;
  }, [fetch]);

  const key = serializeParams(params);

  return useSWR(params.metric ? key : null, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
