'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../dashboard.utils';

export interface CampaignSummary {
  id: string;
  name: string;
  endDate: string | null;
  postCounts: {
    queue: number;
    published: number;
    draft: number;
    error: number;
  };
  goals: Array<{
    metric: string;
    target: number;
    current: number;
    pct: number;
  }>;
}

export const useDashboardCampaigns = (limit = 6) => {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<CampaignSummary[]> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('campaigns_fetch_failed', 'Failed to load campaigns');
      }
      return res.json();
    },
    [fetch]
  );
  return useSWR<CampaignSummary[]>(
    `/dashboard/campaigns?limit=${limit}`,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};
