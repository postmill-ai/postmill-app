'use client';

import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useEffect } from 'react';

export interface CustomFontEntry {
  family: string;
  fileId: string;
  path: string;
  weights: number[];
  italic?: boolean;
}

export const useBrandFonts = () => {
  const user = useUser();
  const fetch = useFetch();
  const { data } = useSWR(
    user?.orgId ? `brands-list-${user.orgId}-fonts` : null,
    async () => {
      const res = await fetch('/brands');
      if (!res.ok) return [];
      const brands = await res.json();
      const fonts: string[] = [];
      brands.forEach((b: any) => {
        if (Array.isArray(b.fontFamilies)) {
          b.fontFamilies.forEach((f: string) => fonts.push(f));
        }
        if (b.fontFamily) fonts.push(b.fontFamily);
        if (b.headingFont) fonts.push(b.headingFont);
      });
      return [...new Set(fonts)];
    }
  );
  return data || [];
};

export const useCustomFonts = (): {
  fonts: CustomFontEntry[];
  mutate: () => void;
} => {
  const user = useUser();
  const fetch = useFetch();
  const { data, mutate } = useSWR<CustomFontEntry[]>(
    user?.orgId ? `custom-fonts-${user.orgId}` : null,
    async () => {
      const res = await fetch('/media/fonts');
      if (!res.ok) return [];
      return res.json();
    }
  );

  const fonts = data || [];

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    for (const f of fonts) {
      try {
        const weight = f.weights.map(String).join(', ') || '400';
        const style = f.italic ? 'italic' : 'normal';
        // Keyed by family ALONE, the second weight of a family was skipped —
        // upload Inter Regular then Inter Bold and Bold never loaded. A face is
        // identified by family + weight + style.
        const existing = Array.from((document.fonts as any).values()).find(
          (ff: any) => ff.family === f.family && ff.weight === weight && ff.style === style
        );
        if (existing) continue;
        const fontFace = new FontFace(f.family, `url(${f.path})`, {
          weight,
          style,
        });
        fontFace.load().then((loaded) => {
          (document.fonts as any).add(loaded);
        }).catch(() => {});
      } catch {}
    }
  }, [fonts]);

  return { fonts, mutate: () => mutate() };
};
