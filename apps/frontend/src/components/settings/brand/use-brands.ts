import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';

export interface BrandAsset {
  fileId?: string;
  url: string;
  caption?: string;
}

export interface BrandCustomFont {
  fileId: string;
  family: string;
  path: string;
  weights: number[];
  italic?: boolean;
  serverRender?: boolean;
}

export interface Brand {
  id: string;
  name: string;
  instructions?: string;
  language?: string;
  platformInstructions?: Record<string, string>;
  languageProfiles?: Record<string, any>;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  palette?: string[];
  fontFamilies?: string[];
  customFonts?: BrandCustomFont[];
  preferredFormats?: string[];
  logoFileIds?: string[];
  introFileId?: string | null;
  outroFileId?: string | null;
  assets?: BrandAsset[];
  enforcement?: { enabled?: boolean } & Record<string, any>;
}

export const useBrands = () => {
  const fetch = useFetch();
  const user = useUser();
  const load = useCallback(async () => {
    const res = await fetch('/brands');
    if (!res.ok) return [];
    return res.json();
  }, [fetch]);
  return useSWR<Brand[]>(user?.orgId ? `brands-list-${user.orgId}` : null, load, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
};
