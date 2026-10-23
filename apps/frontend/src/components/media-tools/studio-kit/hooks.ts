'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { readApiError } from '@postmill-ai/frontend/components/ai/provider-error';
import type { StudioJob, StudioGenerateBody } from './types';

// One hook per resource (react-hooks/rules-of-hooks). No hooks inside returned objects.

export function useStudioStatus(provider: string) {
  const fetch = useFetch();
  return useSWR(`studio-status:${provider}`, async () => {
    const res = await fetch(`/media/studio/${provider}/status`);
    return (await res.json()) as { configured: boolean; enabled: boolean };
  });
}

export function useStudioJobs(provider: string, enabled: boolean) {
  const fetch = useFetch();
  return useSWR(
    enabled ? `studio-jobs:${provider}` : null,
    async () => {
      const res = await fetch(`/media/studio/${provider}/jobs`);
      return (await res.json()) as StudioJob[];
    },
    {
      // Keep the render queue live while anything is still rendering.
      refreshInterval: (data) =>
        Array.isArray(data) &&
        data.some((j) => j.status === 'pending' || j.status === 'processing')
          ? 5000
          : 0,
    }
  );
}

export function useStudioModels(provider: string, operation: string, enabled: boolean) {
  const fetch = useFetch();
  return useSWR(
    enabled ? `studio-models:${provider}:${operation}` : null,
    async () => {
      const res = await fetch(`/media/studio/${provider}/models?operation=${operation}`);
      if (!res.ok) return [] as { id: string; label: string }[];
      return (await res.json()) as { id: string; label: string }[];
    },
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );
}

export function useStudioGenerate(provider: string) {
  const fetch = useFetch();
  return useCallback(
    async (body: StudioGenerateBody) => {
      const res = await fetch(`/media/studio/${provider}/generate`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Never toss the raw JSON body into a toast: a 502 envelope names the
        // org's provider; anything else yields its `message`.
        const apiError = await readApiError(res, 'Generation failed');
        throw Object.assign(new Error(apiError.message), { providerError: apiError.providerError });
      }
      // `duplicate: true` means an idempotency-key retry; the backend now
      // returns the ORIGINAL job's id with it, so jobId is present either way
      // (absent only when the original dispatch never recorded one).
      return (await res.json()) as { jobId?: string; duplicate?: boolean };
    },
    [fetch, provider]
  );
}
