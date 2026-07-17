'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

export interface RecommendationItem {
  type: string;
  title: string;
  description: string;
  action: string;
  link: string;
  priority: number;
}

export interface RecommendationsResponse {
  recommendations: RecommendationItem[];
}

export const useRecommendations = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    const res = await fetch('/analytics/v2/recommendations');
    if (!res.ok) throw createFetchError('recommendations_fetch_failed', 'Failed to fetch recommendations');
    return res.json() as Promise<RecommendationsResponse>;
  }, [fetch]);

  return useSWR('/analytics/v2/recommendations', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
