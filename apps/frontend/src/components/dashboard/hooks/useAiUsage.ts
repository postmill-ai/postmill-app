'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../dashboard.utils';

export interface AiBudget {
  monthlyCap: number | null;
  dailyCap: number | null;
  remainingMonthly: number | null;
  remainingDaily: number | null;
}

export interface AiUsageScopeRow {
  scope: string;
  _sum?: { costUsd?: number };
}

export interface AiUsageResponse {
  byScope: AiUsageScopeRow[];
  totalSpendUsd: number;
  monthlySpendUsd: number;
  dailySpendUsd: number;
  budget: AiBudget | null;
}

export const useAiUsage = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<AiUsageResponse> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('ai_usage_fetch_failed', 'Failed to load AI usage');
      }
      return res.json();
    },
    [fetch]
  );
  return useSWR<AiUsageResponse>('/ai/usage', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
};
