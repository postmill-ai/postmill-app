'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

export interface AnalyticsShareConfigBody {
  integrations?: string[];
  rangePreset?: string;
}

// GET /analytics/v2/share (7.6) — the org's single public share config.
export interface AnalyticsShareConfig {
  token: string | null;
  enabled: boolean;
  config: AnalyticsShareConfigBody;
}

/**
 * Org-level public share config (7.6). One SWR resource
 * (`GET /analytics/v2/share`) plus `save` (POST — mint/rotate/update) and
 * `disable` (DELETE) mutations that revalidate it.
 */
export const useAnalyticsShare = () => {
  const fetch = useFetch();
  const key = '/analytics/v2/share';

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw createFetchError('share_config_fetch_failed', 'Failed to load share config');
      return res.json() as Promise<AnalyticsShareConfig>;
    },
    [fetch]
  );

  const swr = useSWR<AnalyticsShareConfig>(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { mutate } = swr;

  const save = useCallback(
    async (config: AnalyticsShareConfigBody): Promise<AnalyticsShareConfig> => {
      const res = await fetch(key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw createFetchError('share_update_failed', 'Failed to update share');
      const data = (await res.json()) as AnalyticsShareConfig;
      await mutate(data, { revalidate: false });
      return data;
    },
    [fetch, mutate]
  );

  const disable = useCallback(async () => {
    const res = await fetch(key, { method: 'DELETE' });
    if (!res.ok) throw createFetchError('share_disable_failed', 'Failed to disable share');
    await mutate();
  }, [fetch, mutate]);

  return { ...swr, save, disable };
};
