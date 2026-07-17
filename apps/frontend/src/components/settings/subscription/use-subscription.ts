'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR, { mutate as globalMutate } from 'swr';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';
import type { Subscription } from '@prisma/client';

export type SubscriptionTier = 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';

export interface UsageLimits {
  postsPerMonth: number | boolean;
  channels: number | boolean;
  teamMembers: number | boolean;
  storageGb: number;
  videoExports: number;
}

export interface UsageData {
  postsThisCycle: number;
  channels: number;
  teamMembers: number;
  storageBytes: number;
  videoExports: number;
}

export interface UsageResponse {
  billingEnabled: boolean;
  tier?: string;
  byoStorageActive?: boolean;
  limits?: UsageLimits;
  usage?: UsageData;
}

export const SUBSCRIPTION_KEY = 'subscription-row';
export const USAGE_KEY = '/dashboard/usage';

export const useSubscription = () => {
  const fetch = useFetch();
  const load = useCallback(async (): Promise<Subscription> => {
    const res = await fetch('/billing/');
    if (!res.ok) {
      throw createFetchError(
        'subscription_fetch_failed',
        'Failed to load subscription'
      );
    }
    return res.json();
  }, [fetch]);

  return useSWR<Subscription>(SUBSCRIPTION_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

export const useSubscriptionUsage = () => {
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

  return useSWR<UsageResponse>(USAGE_KEY, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

export const refreshSubscriptionData = () => {
  globalMutate(SUBSCRIPTION_KEY);
  globalMutate(USAGE_KEY);
};
