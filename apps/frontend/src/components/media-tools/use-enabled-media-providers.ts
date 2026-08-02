'use client';

import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';

// The set of media provider identifiers the org has enabled (active +
// configured). Used to show only enabled providers in the rail.
export const useEnabledMediaProviders = () => {
  const fetch = useFetch();
  return useSWR<Set<string>>(
    'media-enabled-providers',
    async () => {
      const res = await fetch('/settings/media/config');
      const enabled = new Set<string>();
      if (!res.ok) return enabled;
      const data: { providers?: { identifier: string; isConfigured?: boolean; enabled?: boolean }[] } =
        await res.json();
      for (const cfg of data.providers || []) {
        if (cfg.enabled && cfg.isConfigured) enabled.add(cfg.identifier);
      }
      return enabled;
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
};
