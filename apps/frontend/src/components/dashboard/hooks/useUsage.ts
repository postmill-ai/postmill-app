'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../dashboard.utils';

export interface UsageResponse {
  billingEnabled: boolean;
  tier?: string;
  limits?: {
    postsPerMonth: number | boolean;
    channels: number | boolean;
    teamMembers: number | boolean;
  };
  usage?: {
    postsThisCycle: number;
    channels: number;
    teamMembers: number;
  };
}

export const useUsage = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<UsageResponse> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('usage_fetch_failed', 'Failed to load usage');
      }
      return res.json();
    },
    [fetch]
  );
  return useSWR<UsageResponse>('/dashboard/usage', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};
