'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { readApiError } from '@postmill-ai/frontend/components/ai/provider-error';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
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
      // 502 = the org's AI provider failed (attributed envelope), never Postmill.
      const apiError = await readApiError(
        res,
        t('brief_generation_failed', 'Brief generation failed')
      );
      const err = new Error(apiError.message) as any;
      err.status = res.status;
      err.providerError = apiError.providerError;
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
