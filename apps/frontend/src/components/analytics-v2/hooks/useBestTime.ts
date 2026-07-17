'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useCallback } from 'react';
import { createFetchError } from '../utils';

export type BestTimeConfidence = 'high' | 'medium' | 'low' | 'none';

export interface BestTimeEntry {
  day: number;
  hour: number;
  engagement: number;
  postCount: number;
  avgEngagement: number;
  // 6.4 — sample-size confidence tier; may be absent (fall back to postCount).
  confidence?: BestTimeConfidence;
}

export interface BestTimeSlot {
  day: number;
  hour: number;
  avgEngagement: number;
  // 6.4 — added by the backend so the UI can flag low-sample slots honestly.
  postCount?: number;
  confidence?: BestTimeConfidence;
}

export interface BestTimeResponse {
  heatmap: BestTimeEntry[];
  bestSlots: BestTimeSlot[];
}

interface BestTimeLabel {
  key: string;
  fallback: string;
}

const DAY_LABELS: BestTimeLabel[] = [
  { key: 'day_short_sun', fallback: 'Sun' },
  { key: 'day_short_mon', fallback: 'Mon' },
  { key: 'day_short_tue', fallback: 'Tue' },
  { key: 'day_short_wed', fallback: 'Wed' },
  { key: 'day_short_thu', fallback: 'Thu' },
  { key: 'day_short_fri', fallback: 'Fri' },
  { key: 'day_short_sat', fallback: 'Sat' },
];

const HOUR_LABELS: BestTimeLabel[] = Array.from({ length: 24 }, (_, i) => {
  const fallback =
    i === 0 ? '12a' : i < 12 ? `${i}a` : i === 12 ? '12p' : `${i - 12}p`;
  return { key: `hour_label_${fallback}`, fallback };
});

// The browser IANA timezone — post dates are stored UTC, so bucketing must
// happen in the viewer's zone or "today's" heatmap is silently UTC-shifted (6.4).
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Best-time heatmap data (6.4). Always sends the browser `tz`. `integration`
 * (single, optional) scopes to one channel via the heatmap's channel select;
 * `integrations` (the active dashboard filter) is sent when no single channel
 * is chosen.
 */
export const useBestTime = (integrations?: string[], integration?: string) => {
  const fetch = useFetch();
  const params = new URLSearchParams();
  params.set('tz', browserTimezone());
  if (integration) {
    params.set('integration', integration);
  } else if (integrations?.length) {
    params.set('integrations', integrations.join(','));
  }

  const paramsKey = params.toString();

  const load = useCallback(async () => {
    const res = await fetch(`/analytics/v2/best-time?${paramsKey}`);
    if (!res.ok) throw createFetchError('best_time_fetch_failed', 'Failed to load best time data');
    return res.json();
  }, [fetch, paramsKey]);

  const { data, error, isLoading } = useSWR<BestTimeResponse>(
    `best-time-${paramsKey}`,
    load,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  return { data, error, isLoading, DAY_LABELS, HOUR_LABELS };
};
