'use client';

import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../dashboard.utils';
import type {
  UsageResponse,
} from '@postmill-ai/frontend/components/settings/subscription/use-subscription';

export type { UsageResponse };

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
