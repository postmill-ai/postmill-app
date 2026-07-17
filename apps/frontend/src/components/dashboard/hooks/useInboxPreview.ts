'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../dashboard.utils';

export interface InboxComment {
  id: string;
  authorName: string;
  authorPicture: string | null;
  content: string;
  platformCreatedAt: string;
  post: {
    id: string;
    content: string | null;
    integration: {
      name: string;
      providerIdentifier: string;
      picture: string | null;
    } | null;
  } | null;
}

export interface InboxPreviewResponse {
  comments: InboxComment[];
  nextCursor?: string;
}

export const useInboxPreview = (limit = 4) => {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<InboxPreviewResponse> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('inbox_fetch_failed', 'Failed to load inbox');
      }
      return res.json();
    },
    [fetch]
  );
  return useSWR<InboxPreviewResponse>(
    `/posts/inbox?unreadOnly=true&status=needs_reply&limit=${limit}`,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};
