'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import { createFetchError } from '../dashboard.utils';

export interface ScheduleDay {
  date: string;
  count: number;
}

export interface ScheduleResponse {
  days: ScheduleDay[];
  gaps: string[];
}

export const useSchedule = (days = 7) => {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<ScheduleResponse> => {
      const res = await fetch(url);
      if (!res.ok) {
        throw createFetchError('schedule_fetch_failed', 'Failed to load schedule');
      }
      return res.json();
    },
    [fetch]
  );
  const tz = useSyncExternalStore(
    () => () => {},
    getTimezone,
    () => 'UTC'
  );

  return useSWR<ScheduleResponse>(
    `/dashboard/schedule?days=${days}&timezone=${encodeURIComponent(tz)}`,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};
