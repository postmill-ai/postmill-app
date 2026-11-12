'use client';

import { useBrandKit } from '../brand-kit-context';

export function useBrandColors(): string[] {
  return useBrandKit().activeBrand?.palette || [];
}
