'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';

type ShortLinkPreference = 'ASK' | 'YES' | 'NO';

interface ShortlinkPreferenceResponse {
  shortlink: ShortLinkPreference;
}

export const useShortlinkPreference = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/settings/shortlink')).json();
  }, [fetch]);

  return useSWR<ShortlinkPreferenceResponse>('shortlink-preference', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
