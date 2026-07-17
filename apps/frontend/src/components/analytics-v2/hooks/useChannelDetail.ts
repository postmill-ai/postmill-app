'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { ChannelDetailResponse, createFetchError } from '../utils';

interface ChannelDetailParams {
  integrationId: string;
  from: string;
  to: string;
  compare: boolean;
}

function serializeParams(p: ChannelDetailParams): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    compare: String(p.compare),
  });
  return `/analytics/v2/channel/${encodeURIComponent(p.integrationId)}?${params.toString()}`;
}

export const useChannelDetail = (params: ChannelDetailParams) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('channel_detail_fetch_failed', 'Failed to fetch channel detail');
    return res.json() as Promise<ChannelDetailResponse>;
  }, [fetch]);

  const key = serializeParams(params);

  return useSWR(params.integrationId ? key : null, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
