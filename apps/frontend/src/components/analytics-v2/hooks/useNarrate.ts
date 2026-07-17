'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';

// LLM-narrated period summary (7.5). This is a POST *action* (not an SWR
// resource), so it's a callback hook. The endpoint is AI-provider-gated:
// 503 → "AI not configured", 429 → budget exceeded. Callers surface those
// two states explicitly (via the `code` on the thrown error).
export class NarrateError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export const useNarrate = () => {
  const fetch = useFetch();

  return useCallback(
    async (from: string, to: string): Promise<string> => {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/analytics/v2/narrate?${params.toString()}`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new NarrateError('Failed to generate narration', res.status);
      }
      // The endpoint may return a raw string or `{ text }` / `{ narration }`.
      const body = await res.json().catch(() => null);
      if (typeof body === 'string') return body;
      return body?.text ?? body?.narration ?? '';
    },
    [fetch]
  );
};
