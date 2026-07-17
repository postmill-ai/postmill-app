'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

/**
 * The single, honest "which media tools can this org use" signal, served by
 * `GET /media/tools/status`. Availability is computed with the SAME predicate the
 * generation path uses, so the composer/Designer gating, the Settings disable-state, and
 * the actual generate endpoints can never disagree.
 *
 * Semantics (deliberate, see plan WS2/S2):
 *   - while loading  → optimistic (treat as available; never flash-disable a tool)
 *   - on fetch error → fail-open (status outage must NOT silently kill all media tooling;
 *                      callers fall back to their existing tier.ai/aiActive gating)
 *   - once loaded    → the real per-operation / per-category availability.
 */
export interface MediaToolEntry {
  available: boolean;
  provider?: string;
  version?: string;
  model?: string;
  reason?: string;
}
export interface MediaToolsStatusData {
  operations: Record<string, { available: boolean; provider?: string }>;
  tools: Record<string, MediaToolEntry>;
}

export const useMediaToolsStatus = () => {
  const fetch = useFetch();
  const { data, isLoading } = useSWR<MediaToolsStatusData>(
    '/media/tools/status',
    (url: string) =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error('status unavailable');
        return r.json();
      }),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      // No retries-as-disabled: on error `data` stays undefined → helpers fail-open.
      shouldRetryOnError: false,
    }
  );

  // `data` is undefined while loading AND on error → both resolve to the optimistic
  // `true`, so a slow/broken status endpoint never disables a tool the user might have.
  const operationAvailable = (operation: string): boolean =>
    data ? !!data.operations?.[operation]?.available : true;

  const toolAvailable = (category: string): boolean =>
    data ? !!data.tools?.[category]?.available : true;

  const tool = (category: string): MediaToolEntry | undefined =>
    data?.tools?.[category];

  return { status: data, isLoading, operationAvailable, toolAvailable, tool };
};

/** Canonical deep-link to the media provider setup page. */
export const MEDIA_SETUP_HREF = '/settings/content/ai-media';
