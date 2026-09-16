'use client';

import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import { ProviderError, readApiError } from '@postmill-ai/frontend/components/ai/provider-error';

// LLM-narrated period summary (7.5). This is a POST *action* (not an SWR
// resource), so it's a callback hook. The endpoint is AI-provider-gated:
// 503 → "AI not configured", 429 → budget exceeded. Callers surface those
// two states explicitly (via the `code` on the thrown error).
export class NarrateError extends Error {
  code: number;
  // Set when the failure came from the org's AI provider (502 envelope).
  providerError?: ProviderError;
  constructor(message: string, code: number, providerError?: ProviderError) {
    super(message);
    this.code = code;
    this.providerError = providerError;
  }
}

export const useNarrate = () => {
  const fetch = useFetch();

  return useCallback(
    async (from: string, to: string): Promise<string> => {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/public/v1/analytics/narrate?${params.toString()}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const apiError = await readApiError(res, 'Failed to generate narration');
        throw new NarrateError(apiError.message, res.status, apiError.providerError);
      }
      // The endpoint may return a raw string or `{ text }` / `{ narration }`.
      const body = await res.json().catch(() => null);
      if (typeof body === 'string') return body;
      return body?.text ?? body?.narration ?? '';
    },
    [fetch]
  );
};
