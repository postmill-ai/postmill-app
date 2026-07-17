'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { ChannelMetricResponse, createFetchError } from '../utils';

interface ChannelMetricParams {
  integrationId: string;
  metric: string;
  from: string;
  to: string;
  compare: boolean;
}

function serializeParams(p: ChannelMetricParams): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    compare: String(p.compare),
  });
  return `/analytics/v2/channel/${encodeURIComponent(p.integrationId)}/metric/${encodeURIComponent(p.metric)}?${params.toString()}`;
}

export const useChannelMetric = (params: ChannelMetricParams) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('channel_metric_fetch_failed', 'Failed to fetch channel metric');
    return res.json() as Promise<ChannelMetricResponse>;
  }, [fetch]);

  const key = params.integrationId && params.metric ? serializeParams(params) : null;

  return useSWR(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
