import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface BrandAsset {
  fileId?: string;
  url: string;
  caption?: string;
}

export interface Brand {
  id: string;
  name: string;
  instructions?: string;
  language?: string;
  platformInstructions?: Record<string, string>;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  palette?: string[];
  assets?: BrandAsset[];
  enforcement?: { enabled?: boolean } & Record<string, any>;
}

// Shared brand-list fetch, used by the brand list page and each brand-edit route page
// (SWR dedupes the `brands-list` request across them).
export const useBrands = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/brands');
    if (!res.ok) return [];
    return res.json();
  }, [fetch]);
  return useSWR<Brand[]>('brands-list', load, {
    revalidateOnFocus: false,
  });
};
