'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useCallback } from 'react';
import { createFetchError } from '../dashboard.utils';

export interface DashboardSummary {
  totalPosts: number;
  scheduledPosts: number;
  publishedNext7: number;
  channelsConnected: number;
  drafts: number;
  upcomingPosts: Array<{
    id: string;
    content: string | null;
    publishDate: string;
    channelName: string | null;
    providerIdentifier: string | null;
  }>;
  commentUnreadCount: number;
  aiProviderActive: boolean;
  mediaProviderActive: boolean;
  storageProviderActive: boolean;
  teamMembers: number;
}

export const useDashboardSummary = () => {
  const fetch = useFetch();
  const load = useCallback(async (url: string): Promise<DashboardSummary> => {
    const res = await fetch(url);
    if (!res.ok) {
      throw createFetchError('summary_fetch_failed', 'Failed to load summary');
    }
    return res.json();
  }, [fetch]);
  return useSWR<DashboardSummary>('/dashboard/summary', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};
