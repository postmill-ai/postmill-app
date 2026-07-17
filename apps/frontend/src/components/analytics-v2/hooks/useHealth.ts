'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

// One data-health row from GET /analytics/v2/health (6.6). Shape mirrors the
// backend `getDataHealth` response (DataHealthItem in analytics.types.ts).
export interface HealthItem {
  integrationId: string;
  name: string;
  identifier: string;
  picture: string | null;
  // provider implements analytics() — false = "not supported by <provider>"
  supportsAnalytics: boolean;
  lastSnapshotDate: string | null;
  // window coverage fraction (0..1)
  coverage: number;
  // no snapshot in the last 48h (only meaningful when supportsAnalytics)
  stale: boolean;
}

/**
 * Data-health / trust surface (6.6). SWR over `GET /analytics/v2/health`;
 * lists every integration with whether its provider supports analytics, its
 * last snapshot date, window coverage, and a stale flag. One hook per resource.
 */
export const useHealth = () => {
  const fetch = useFetch();

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw createFetchError('health_fetch_failed', 'Failed to fetch data health');
      return res.json() as Promise<HealthItem[]>;
    },
    [fetch]
  );

  return useSWR('/analytics/v2/health', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};
