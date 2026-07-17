'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

interface BrandProfile {
  id: string;
  palette?: string[];
  isDefault: boolean;
}

export function useBrandColors(): string[] {
  const fetch = useFetch();
  const user = useUser();

  const { data: brands } = useSWR<BrandProfile[]>(
    `brands-list-${user.orgId}`,
    async () => {
      const res = await fetch('/brands');
      if (!res.ok) return [];
      return res.json();
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const activeBrand = useMemo(
    () => brands?.find((b) => b.isDefault) || brands?.[0] || null,
    [brands],
  );

  return useMemo(
    () => (Array.isArray(activeBrand?.palette) ? activeBrand!.palette! : []),
    [activeBrand],
  );
}
