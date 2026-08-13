'use client';

import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { createFetchError } from '../dashboard.utils';

export interface MediaJob {
  id: string;
  provider: string;
  operation: string;
  status: string;
  artifactUrl: string | null;
  /** Set once the artifact has landed in /files; required by the composer handoff. */
  fileId: string | null;
  error: string | null;
  createdAt: string;
}

export interface MediaJobsResponse {
  jobs: MediaJob[];
  /** Id of the last job on this page, or null when there is nothing after it. */
  nextCursor?: string | null;
  counts: {
    pending: number;
    processing: number;
    failed7d: number;
  };
}

const isActive = (status: string) =>
  status === 'pending' || status === 'processing';

export const useMediaJobs = (enabled = true) => {
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
  // A null key disables the fetch entirely (SWR) — used by callers that already
  // know the user lacks media:read, so they don't fire a 403 every mount.
  const { data, error, isLoading, mutate } = useSWR<MediaJobsResponse>(
    enabled ? '/dashboard/media-jobs' : null,
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

const QUEUE_PAGE_SIZE = 20;

/**
 * Paginated, filterable view of the same endpoint for /media/queue.
 *
 * Kept beside `useMediaJobs` so both share one `MediaJob` shape. The keys differ
 * (these carry `limit`/`status`), so the queue never evicts the dashboard
 * widget's cache entry, and vice versa.
 */
export const useMediaJobsQueue = (status?: string) => {
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

  const getKey = useCallback(
    (index: number, previous: MediaJobsResponse | null) => {
      // A page with no cursor is the last one.
      if (previous && !previous.nextCursor) return null;
      const params = new URLSearchParams({ limit: String(QUEUE_PAGE_SIZE) });
      if (status) params.set('status', status);
      if (previous?.nextCursor) params.set('cursor', previous.nextCursor);
      return `/dashboard/media-jobs?${params.toString()}`;
    },
    [status]
  );

  const { data, error, isLoading, isValidating, size, setSize, mutate } =
    useSWRInfinite<MediaJobsResponse>(getKey, load, {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
      // Poll only while something is still rendering. `latest` here is the array
      // of loaded pages, not a single page.
      refreshInterval: (latest) =>
        (latest ?? []).some((page) => page.jobs.some((j) => isActive(j.status)))
          ? 5000
          : 0,
    });

  const jobs = useMemo(() => (data ?? []).flatMap((page) => page.jobs), [data]);
  const counts = data?.[0]?.counts;
  const hasMore = !!data?.[data.length - 1]?.nextCursor;

  return {
    jobs,
    counts,
    error,
    isLoading,
    hasMore,
    isLoadingMore: isValidating && size > 1,
    loadMore: () => setSize(size + 1),
    mutate,
  };
};
