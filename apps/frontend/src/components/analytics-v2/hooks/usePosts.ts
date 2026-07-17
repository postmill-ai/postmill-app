'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { PostsResponse, createFetchError } from '../utils';

interface PostsParams {
  from: string;
  to: string;
  integrations: string[];
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  limit: number;
  /** Campaign filter (1.6) — server-scopes posts to these campaigns. */
  campaigns?: string[];
}

function serializeParams(p: PostsParams): string {
  const params = new URLSearchParams({
    from: p.from,
    to: p.to,
    integrations: p.integrations.join(','),
    sort: p.sort,
    dir: p.dir,
    page: String(p.page),
    limit: String(p.limit),
  });
  if (p.campaigns?.length) {
    params.set('campaigns', p.campaigns.join(','));
  }
  return `/analytics/v2/posts?${params.toString()}`;
}

export const usePosts = (params?: PostsParams) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('posts_fetch_failed', 'Failed to fetch posts');
    return res.json() as Promise<PostsResponse>;
  }, [fetch]);

  const key = params ? serializeParams(params) : null;

  return useSWR(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
