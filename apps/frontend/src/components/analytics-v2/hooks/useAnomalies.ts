'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

// One anomaly row from GET /analytics/v2/anomalies (4.8). Shape mirrors the
// backend `listAnomalies` response (AnalyticsAnomaly + included integration).
export interface AnomalyRow {
  id: string;
  integrationId: string;
  metric: string;
  direction: 'spike' | 'drop';
  value: number;
  baseline: number;
  deviation: number;
  topPostId: string | null;
  // Set when this alert was fired by a user-defined rule (7.3) rather than the
  // automatic detector — the Alerts list badges these differently.
  ruleId?: string | null;
  notifiedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  integration: {
    id: string;
    name: string;
    providerIdentifier: string;
    picture: string | null;
  };
}

/**
 * Anomaly alerts feed (4.8). SWR over `GET /analytics/v2/anomalies`; the default
 * (no `includeDismissed`) returns only undismissed rows. `dismiss(id)` POSTs the
 * dismiss route and optimistically removes the row before revalidating.
 */
export const useAnomalies = (includeDismissed = false) => {
  const fetch = useFetch();

  const key = `/analytics/v2/anomalies${
    includeDismissed ? '?includeDismissed=true' : ''
  }`;

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw createFetchError('anomalies_fetch_failed', 'Failed to fetch anomalies');
      return res.json() as Promise<AnomalyRow[]>;
    },
    [fetch]
  );

  const swr = useSWR(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  const { mutate } = swr;

  const dismiss = useCallback(
    async (id: string) => {
      // Optimistic removal — drop the row locally, POST, then revalidate.
      await mutate(
        (current) => (current || []).filter((a) => a.id !== id),
        { revalidate: false }
      );
      try {
        const res = await fetch(`/analytics/v2/anomalies/${id}/dismiss`, {
          method: 'POST',
        });
        if (!res.ok) throw createFetchError('anomaly_dismiss_failed', 'Failed to dismiss anomaly');
      } finally {
        // Re-sync with the server whether the POST succeeded or failed.
        mutate();
      }
    },
    [fetch, mutate]
  );

  return { ...swr, dismiss };
};
