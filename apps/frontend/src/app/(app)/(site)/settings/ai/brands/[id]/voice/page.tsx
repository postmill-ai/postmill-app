'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { BrandVoice } from '@gitroom/frontend/components/settings/brand/brand-voice';
import { useBrands } from '@gitroom/frontend/components/settings/brand/use-brands';

export default function Page() {
  const params = useParams();
  const id = String(params.id);
  const { data: brands, mutate } = useBrands();
  const brand = brands?.find((b) => b.id === id);
  if (!brand) return null;
  return (
    <BrandVoice key={brand.id} brandId={brand.id} initial={brand} onSaved={() => mutate()} />
  );
}
