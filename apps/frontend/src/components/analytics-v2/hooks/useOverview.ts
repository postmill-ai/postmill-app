'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { OverviewResponse, createFetchError } from '../utils';

interface OverviewParams {
  from: string;
  to: string;
  integrations: string[];
  compare: boolean;
  /** Campaign filter (1.6) — server-scopes metrics to these campaigns' posts. */
  campaigns?: string[];
}

function serializeParams(p: OverviewParams): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    integrations: p.integrations.join(','),
    compare: String(p.compare),
  });
  if (p.campaigns?.length) {
    params.set('campaigns', p.campaigns.join(','));
  }
  return `/analytics/v2/overview?${params.toString()}`;
}

export const useOverview = (params: OverviewParams) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('overview_fetch_failed', 'Failed to fetch overview');
    return res.json() as Promise<OverviewResponse>;
  }, [fetch]);

  const key = serializeParams(params);

  return useSWR(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
