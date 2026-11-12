'use client';

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useBrands, type Brand, type BrandCustomFont } from '@postmill-ai/frontend/components/settings/brand/use-brands';
import { useCustomFonts } from './panels/use-brand-fonts';

interface BrandKitContextValue {
  brands: Brand[] | undefined;
  activeBrand: Brand | null;
  customFonts: BrandCustomFont[];
  brandUnavailable: boolean;
  isGeneralMode: boolean;
  selectBrand: (brandProfileId: string | null) => void;
  refreshBrands: () => Promise<Brand[] | undefined>;
  refreshFonts: () => void;
}

const BrandKitContext = createContext<BrandKitContextValue | null>(null);

export const BrandKitProvider = ({ store, children }: { store: any; children: React.ReactNode }) => {
  const { data: brands, mutate: refreshBrands } = useBrands();
  const selection = store((state: any) => state.doc.brandProfileId);
  const activeBrand = useMemo(() => {
    if (typeof selection === 'string') {
      return brands?.find((brand) => brand.id === selection && brand.enabled) || null;
    }
    if (selection === null) return null;
    return brands?.find((brand) => brand.isDefault && brand.enabled) || brands?.find((brand) => brand.enabled) || null;
  }, [brands, selection]);
  const fontScope = selection === null
    ? null
    : activeBrand?.id ?? (typeof selection === 'string' ? false : undefined);
  const { fonts: customFonts, mutate: refreshFonts } = useCustomFonts(fontScope);

  useEffect(() => {
    store.getState().setBrandEnforcement(!!activeBrand?.enforcement?.enabled);
  }, [activeBrand, store]);

  const value = useMemo<BrandKitContextValue>(() => ({
    brands,
    activeBrand,
    customFonts,
    brandUnavailable: typeof selection === 'string' && brands !== undefined && !activeBrand,
    isGeneralMode: selection === null,
    selectBrand: (brandProfileId) => store.getState().setBrandProfileId(brandProfileId),
    refreshBrands,
    refreshFonts,
  }), [brands, activeBrand, customFonts, selection, refreshBrands, refreshFonts, store]);

  return <BrandKitContext.Provider value={value}>{children}</BrandKitContext.Provider>;
};

export const useBrandKit = () => {
  const context = useContext(BrandKitContext);
  if (!context) throw new Error('useBrandKit must be used inside BrandKitProvider');
  return context;
};
