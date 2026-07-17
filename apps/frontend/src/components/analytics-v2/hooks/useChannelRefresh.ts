'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';

// On-demand channel refresh (6.7). POSTs /analytics/v2/refresh/:integrationId,
// which re-fetches the provider's live analytics and persists them through the
// same upsert the sweep uses. This is a mutation, so it's a callback hook — the
// caller revalidates the overview/channel SWR keys on success and toasts on
// error (429 throttle / 502 provider failure).
export class ChannelRefreshError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const useChannelRefresh = () => {
  const fetch = useFetch();

  return useCallback(
    async (integrationId: string): Promise<void> => {
      const res = await fetch(`/analytics/v2/refresh/${integrationId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new ChannelRefreshError('Failed to refresh channel', res.status);
      }
    },
    [fetch]
  );
};
