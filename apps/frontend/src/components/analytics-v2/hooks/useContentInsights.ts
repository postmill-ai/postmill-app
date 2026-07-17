'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

// One ranked "what works" finding (7.4). `bucket` is the machine key used to
// deep-link the posts tab; `label` is the human copy; `ratio` is the bucket's
// mean engagement ÷ the org mean; `sampleSize` is always shown.
export interface ContentFinding {
  label: string;
  bucket: string;
  ratio: number;
  sampleSize: number;
  /** Optional grouping dimension (e.g. 'mediaType', 'hour') for deep-link params. */
  dimension?: string;
}

export interface ContentInsightsResponse {
  findings: ContentFinding[];
  totalPosts: number;
  orgMean: number;
}

/** Content-attribute intelligence (7.4). One SWR resource. */
export const useContentInsights = () => {
  const fetch = useFetch();

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw createFetchError('content_insights_fetch_failed', 'Failed to load content insights');
      return res.json() as Promise<ContentInsightsResponse>;
    },
    [fetch]
  );

  return useSWR<ContentInsightsResponse>('/analytics/v2/content-insights', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};
