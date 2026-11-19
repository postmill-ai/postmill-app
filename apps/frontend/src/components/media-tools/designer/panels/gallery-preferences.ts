'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

export type DesignerGallerySize = 's' | 'm' | 'l';

const EVENT = 'designer-gallery-size-change';
const isSize = (value: string | null): value is DesignerGallerySize =>
  value === 's' || value === 'm' || value === 'l';

export const readDesignerGallerySize = (
  storage: Pick<Storage, 'getItem'>,
  orgId?: string,
): DesignerGallerySize => {
  try {
    const value = storage.getItem(`designer-gallery-size-${orgId || 'general'}`);
    return isSize(value) ? value : 'm';
  } catch {
    return 'm';
  }
};

export const designerGalleryGridStyle = (size: DesignerGallerySize) => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${{ s: 150, m: 200, l: 260 }[size]}px), 1fr))`,
});

export const useDesignerGallerySize = (orgId?: string) => {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener('storage', onChange);
    window.addEventListener(EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(EVENT, onChange);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    try {
      return readDesignerGallerySize(window.localStorage, orgId);
    } catch {
      return 'm' as const;
    }
  }, [orgId]);
  const storedSize = useSyncExternalStore(subscribe, getSnapshot, () => 'm' as const);
  const [override, setOverride] = useState<{ orgId?: string; size: DesignerGallerySize } | null>(null);
  const size = override?.orgId === orgId ? override.size : storedSize;
  const setSize = useCallback((next: DesignerGallerySize) => {
    try {
      localStorage.setItem(`designer-gallery-size-${orgId || 'general'}`, next);
    } catch {}
    setOverride({ orgId, size: next });
    window.dispatchEvent(new Event(EVENT));
  }, [orgId]);
  return { size, setSize };
};
