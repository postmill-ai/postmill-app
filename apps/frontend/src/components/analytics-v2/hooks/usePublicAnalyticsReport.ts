'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

// Public org analytics report (7.6). Read-only, token-scoped, whitelisted:
// no ids beyond a channel's provider identifier, no org metadata.
export interface PublicAnalyticsReport {
  kpis: {
    metric: string;
    label: string;
    format: 'number' | 'percent' | 'currency' | 'time';
    total: number;
    previousTotal: number;
    percentageChange: number;
    sparkline: { date: string; value: number }[];
  }[];
  series: Record<string, { date: string; value: number }[]>;
  byChannel: {
    name: string;
    identifier: string;
    kpis: { metric: string; label: string; total: number }[];
  }[];
  range: { from: string; to: string };
}

/**
 * Public analytics report by share token (7.6). Mirrors
 * `usePublicCampaignReport` — the backend `/public/analytics-report/:token`
 * route ignores auth cookies, so this renders for anyone with the link.
 */
export const usePublicAnalyticsReport = (token?: string) => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    const res = await fetch(`/public/analytics-report/${token}`);
    if (!res.ok) throw createFetchError('shared_report_fetch_failed', 'Failed to load shared report');
    return res.json() as Promise<PublicAnalyticsReport>;
  }, [fetch, token]);

  return useSWR<PublicAnalyticsReport>(
    token ? `public-analytics-report-${token}` : null,
    load,
    { revalidateOnFocus: false }
  );
};
