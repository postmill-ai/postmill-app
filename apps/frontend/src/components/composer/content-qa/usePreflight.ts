'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback, useState } from 'react';

export interface PreflightResultItem {
  integrationId: string;
  identifier: string;
  name: string;
  valid: boolean;
  warnings: string[];
  blocks: string[];
  maximumCharacters?: number;
}

export interface PreflightResponse {
  passed: boolean;
  results: PreflightResultItem[];
  blocking: PreflightResultItem[];
}

export interface PreflightParams {
  type: string;
  posts: any[];
  date?: string;
  tags?: string;
  shortLink?: boolean;
}

export const usePreflight = () => {
  const fetch = useFetch();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPreflight = useCallback(
    async (params: PreflightParams) => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch('/posts/preflight', {
          method: 'POST',
          body: JSON.stringify(params),
        });
        if (!res.ok) {
          throw new Error('Preflight check failed');
        }
        const result: PreflightResponse = await res.json();
        setData(result);
        return result;
      } catch (err: any) {
        setError(err?.message || 'Preflight check failed');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [fetch]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { runPreflight, loading, data, error, reset };
};
