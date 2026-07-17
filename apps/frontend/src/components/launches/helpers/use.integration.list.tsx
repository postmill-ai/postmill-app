'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';

export const useIntegrationList = () => {
  const fetch = useFetch();

  // Return type stays `any` (not `any[]`) so the inferred SWR `data`/`mutate`
  // types are unchanged for consumers; the runtime value is always an array.
  const load = useCallback(async (path: string): Promise<any> => {
    // Always resolve to an array. If `/integrations/list` errors or returns an
    // unexpected shape, `.integrations` can be a non-array — and consumers do
    // `integrations?.filter(...)` / `.map(...)` in render `useMemo`s, so a
    // non-array throws `_?.filter is not a function` and crashes the whole tree
    // (white screen on /posts). Coerce here so every consumer stays safe.
    const json = await (await fetch(path)).json().catch(() => null);
    const list = json?.integrations;
    return Array.isArray(list) ? list : [];
  }, [fetch]);

  return useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });
};