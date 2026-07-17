'use client';

import { useCallback, useMemo } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWRInfinite from 'swr/infinite';
import { StockSearchResponse } from './stock.types';

export interface UseStockSearchResult<T> {
  items: T[];
  lastPage: StockSearchResponse<T> | undefined;
  error: any;
  isLoading: boolean;
  isValidating: boolean;
  size: number;
  setSize: (size: number | ((s: number) => number)) => void;
  mutate: () => void;
}

export function useStockSearch<T>(
  endpoint: string,
  query: string,
  filters: Record<string, string>
): UseStockSearchResult<T> {
  const fetch = useFetch();

  const getKey = useCallback(
    (pageIndex: number, previousPageData: StockSearchResponse<T> | null) => {
      if (previousPageData && pageIndex + 1 > previousPageData.totalPages) {
        return null;
      }
      return [endpoint, query, pageIndex + 1, filters] as const;
    },
    [endpoint, query, filters]
  );

  const { data, error, isLoading, isValidating, size, setSize, mutate } =
    useSWRInfinite<StockSearchResponse<T>>(
      getKey,
      async ([ep, q, page, f]: readonly [string, string, number, Record<string, string>]) => {
        const params = new URLSearchParams();
        if (q) params.set('query', q);
        params.set('page', String(page));
        for (const [key, value] of Object.entries(f)) {
          if (value) params.set(key, value);
        }
        const res = await fetch(`${ep}?${params}`);
        if (!res.ok) {
          const err: any = new Error(`Request failed (HTTP ${res.status})`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
      { keepPreviousData: true }
    );

  const items = useMemo(
    () => (data ? data.flatMap((page) => page.results) : []),
    [data]
  );

  return {
    items,
    lastPage: data?.[data.length - 1],
    error,
    isLoading,
    isValidating,
    size,
    setSize,
    mutate,
  };
}
