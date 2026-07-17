'use client';

import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

/**
 * Whether the current org has an active AI provider configured.
 *
 * Source of truth is `/settings/ai/config` → `active` (null when no provider).
 * Returns `undefined` while loading so callers can avoid flashing AI UI before
 * the answer is known. When `false`, the app must NOT mount CopilotKit (its
 * runtime handshake would 403 on the CSRF-protected /copilot routes and spam
 * the console) — route the user to the AI setup page (`/settings/ai/llm-providers`)
 * instead. See copilot-bridges.tsx and layout.component.tsx.
 */
export const useAiActive = (): boolean | undefined => {
  const fetch = useFetch();
  const { data, isLoading } = useSWR(
    '/settings/ai/config',
    (url: string) => fetch(url).then((r) => r.json()),
    {
      revalidateOnFocus: false,
      // keep this cheap + shared across every consumer (layout + bridges)
      dedupingInterval: 60_000,
      fallbackData: undefined,
    }
  );
  if (isLoading && !data) return undefined;
  return data?.active !== null && data?.active !== undefined;
};

/** Canonical deep-link to the AI provider setup page. */
export const AI_SETUP_HREF = '/settings/ai/llm-providers';
