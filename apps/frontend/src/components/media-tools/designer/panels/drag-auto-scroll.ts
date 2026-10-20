'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Distance from a container's top/bottom edge where drag auto-scroll engages. */
export const DRAG_SCROLL_EDGE_PX = 28;
/** Fastest scroll speed (px per animation frame), reached right at the edge. */
export const DRAG_SCROLL_MAX_SPEED_PX = 8;

/**
 * Pixels to scroll per frame while a dragged pointer hovers near a scroll
 * container's vertical edges: negative scrolls up, positive scrolls down, 0
 * means the pointer is in the comfortable middle (or outside the container).
 * Speed ramps linearly from 0 at the edge boundary to max at the very edge, so
 * easing toward a folder is controllable. Pure so the edge math is testable.
 */
export const dragScrollDelta = (
  containerTop: number,
  containerBottom: number,
  pointerY: number,
  edgePx: number = DRAG_SCROLL_EDGE_PX,
  maxSpeedPx: number = DRAG_SCROLL_MAX_SPEED_PX
): number => {
  if (pointerY < containerTop || pointerY > containerBottom) return 0;
  const fromTop = pointerY - containerTop;
  if (fromTop < edgePx) {
    return -Math.max(1, Math.round(maxSpeedPx * (1 - fromTop / edgePx)));
  }
  const fromBottom = containerBottom - pointerY;
  if (fromBottom < edgePx) {
    return Math.max(1, Math.round(maxSpeedPx * (1 - fromBottom / edgePx)));
  }
  return 0;
};

/**
 * Auto-scrolls a (small, overflowed) container while an HTML5 drag hovers near
 * its top/bottom edge, so out-of-view rows stay reachable as drop targets.
 * Spread `autoScrollProps` on the scroll container; HTML5 drag gives no
 * pointermove, so the pointer's clientY is sampled from dragover events and a
 * rAF loop applies the scroll until the drag leaves, drops, or ends.
 */
export function useDragAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const pointerY = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  // The rAF loop self-reschedules; hold the ticking function in a ref so it
  // can requeue itself without a useCallback self-reference (react-compiler
  // rejects those).
  const tickRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    pointerY.current = null;
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  }, []);

  useEffect(() => {
    tickRef.current = () => {
      const el = ref.current;
      if (!el || pointerY.current === null) {
        raf.current = null;
        return;
      }
      const rect = el.getBoundingClientRect();
      const delta = dragScrollDelta(rect.top, rect.bottom, pointerY.current);
      if (delta) el.scrollTop += delta;
      raf.current = requestAnimationFrame(tickRef.current!);
    };
    return () => {
      tickRef.current = null;
    };
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    pointerY.current = e.clientY;
    if (raf.current === null && tickRef.current) {
      raf.current = requestAnimationFrame(tickRef.current);
    }
  }, []);

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      // dragleave fires for every descendant too — only the pointer genuinely
      // leaving the container should stop the loop.
      if (e.relatedTarget instanceof Node && ref.current?.contains(e.relatedTarget)) return;
      stop();
    },
    [stop]
  );

  useEffect(() => {
    // dragend fires on the drag source, not the drop targets — listen globally
    // so a drop handled (and stopPropagation'd) by a row, or an Esc-cancelled
    // drag, still stops the loop.
    document.addEventListener('dragend', stop);
    return () => {
      document.removeEventListener('dragend', stop);
      stop();
    };
  }, [stop]);

  return { ref, autoScrollProps: { onDragOver, onDragLeave, onDrop: stop } };
}
