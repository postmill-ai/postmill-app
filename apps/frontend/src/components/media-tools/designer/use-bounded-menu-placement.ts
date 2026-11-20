import { RefObject, useLayoutEffect, useRef, useState } from 'react';
import { getContextMenuPlacement, measureMenuSize, type MenuPlacement } from './context-menu-position';

interface Point {
  x: number;
  y: number;
}

/**
 * Viewport-bounded placement for a fixed-position menu with several views
 * (for example a main list and sub-menus that replace it in place).
 *
 * Each view is measured at its natural size: when `viewKey` changes, the hook
 * returns null for one layout pass, so the new view renders without the
 * previous view's caps and is measured before paint. Sizes are remembered per
 * view while the menu stays open, so going Back restores the size the view
 * first opened with. Passing a new `point` (a new open) forgets them.
 */
export function useBoundedMenuPlacement(
  ref: RefObject<HTMLElement | null>,
  point: Point | null,
  viewKey: string,
): MenuPlacement | null {
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  const openedAt = useRef<Point | null>(null);
  const [placed, setPlaced] = useState<{ point: Point; viewKey: string; placement: MenuPlacement } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (openedAt.current !== point) {
      openedAt.current = point;
      sizes.current.clear();
    }
    // A closed menu needs no reset: the stored placement is tagged with its
    // point, so it stops matching as soon as the menu closes or reopens.
    if (!point || !element) return;
    const size = measureMenuSize(element, sizes.current.get(viewKey));
    sizes.current.set(viewKey, size);
    setPlaced({
      point,
      viewKey,
      placement: getContextMenuPlacement(point, size, { width: window.innerWidth, height: window.innerHeight }),
    });
  }, [ref, point, viewKey]);

  return placed && placed.point === point && placed.viewKey === viewKey ? placed.placement : null;
}
