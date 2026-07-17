'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { PostDetail, createFetchError } from '../utils';

export const usePostDetail = (postId: string) => {
  const fetch = useFetch();

  const load = useCallback(async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw createFetchError('post_detail_fetch_failed', 'Failed to fetch post detail');
    return res.json() as Promise<PostDetail>;
  }, [fetch]);

  return useSWR(postId ? `/analytics/v2/post/${postId}` : null, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
