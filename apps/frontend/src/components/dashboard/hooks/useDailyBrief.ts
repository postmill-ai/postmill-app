'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { createFetchError } from '../dashboard.utils';

export interface DailyBriefResponse {
  brief: string;
  generatedAt: string;
}

export interface DailyBriefEmpty {
  cached: false;
}

export const useDailyBrief = () => {
  const fetch = useFetch();
  const t = useT();
  const load = useCallback(
    async (url: string): Promise<DailyBriefResponse | DailyBriefEmpty> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('brief_fetch_failed', 'Failed to load brief');
      }
      return res.json();
    },
    [fetch]
  );

  const { data, error, isLoading, mutate } = useSWR<DailyBriefResponse | DailyBriefEmpty>(
    '/dashboard/brief',
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const generate = useCallback(async (): Promise<DailyBriefResponse> => {
    const res = await fetch('/dashboard/brief', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(
        body.message ||
          t('brief_generation_failed_with_status', 'Brief generation failed ({{status}})', {
            status: res.status,
          })
      ) as any;
      err.status = res.status;
      throw err;
    }
    const result: DailyBriefResponse = await res.json();
    await mutate(result, false);
    return result;
  }, [fetch, mutate, t]);

  return {
    data,
    error,
    isLoading,
    generate,
  };
};
