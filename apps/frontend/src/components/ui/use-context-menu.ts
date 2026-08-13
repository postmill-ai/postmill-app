'use client';

import { useCallback, useState } from 'react';

export type ContextMenuState<T> = { x: number; y: number; target: T };

type OpenEvent = {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  preventDefault?: () => void;
};

/**
 * Tracks which item a pointer-anchored `ContextMenu` belongs to and where it
 * should appear. Pair with `<ContextMenu {...menu} />`.
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null);

  const openAt = useCallback((e: OpenEvent, target: T) => {
    e.preventDefault?.();

    let { clientX: x, clientY: y } = e;
    // Keyboard invocation (Shift+F10 / the Menu key) fires the same `contextmenu`
    // event but reports 0,0 in several browsers — anchor to the element instead
    // so the menu doesn't land in the corner of the screen.
    if (!x && !y) {
      const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
      if (rect) {
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      }
    }

    setMenu({ x, y, target });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, openAt, close };
}
