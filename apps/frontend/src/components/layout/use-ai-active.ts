'use client';

import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';

/**
 * Whether the current org's AI agent scope is actually usable.
 *
 * Source of truth is `/settings/ai/config` → `active` (null when no provider)
 * plus `agentReady` (false when the active provider can't resolve for the agent
 * scope — e.g. credentials incomplete). `active != null` alone is NOT enough:
 * mounting CopilotKit for a provider that fails agent-scope resolution makes
 * the /copilot/chat handshake reject (the runtime has no usable agent), which
 * cascades into "Agent 'default' not found" / `.map is not a function` crashes
 * on every page (Sentry POSTMILL-APP-D/E/F).
 * Returns `undefined` while loading so callers can avoid flashing AI UI before
 * the answer is known. When `false`, the app must NOT mount CopilotKit — route
 * the user to the AI setup page (`/settings/ai/llm-providers`) instead. See
 * copilot-bridges.tsx and layout.component.tsx.
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
  return (
    data?.active !== null &&
    data?.active !== undefined &&
    data?.agentReady === true
  );
};

/** Canonical deep-link to the AI provider setup page. */
export const AI_SETUP_HREF = '/settings/ai/llm-providers';
