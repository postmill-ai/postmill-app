'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../dashboard.utils';

export interface MediaJob {
  id: string;
  provider: string;
  operation: string;
  status: string;
  artifactUrl: string | null;
  error: string | null;
  createdAt: string;
}

export interface MediaJobsResponse {
  jobs: MediaJob[];
  counts: {
    pending: number;
    processing: number;
    failed7d: number;
  };
}

const isActive = (status: string) =>
  status === 'pending' || status === 'processing';

export const useMediaJobs = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<MediaJobsResponse> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('media_jobs_fetch_failed', 'Failed to load media jobs');
      }
      return res.json();
    },
    [fetch]
  );
  const { data, error, isLoading, mutate } = useSWR<MediaJobsResponse>(
    '/dashboard/media-jobs',
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: (latest) => {
        if (!latest) return 0;
        return latest.jobs.some((j) => isActive(j.status)) ? 5000 : 0;
      },
    }
  );
  return { data, error, isLoading, mutate };
};
