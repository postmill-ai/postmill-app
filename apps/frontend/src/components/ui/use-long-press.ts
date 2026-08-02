'use client';

import React, { useCallback, useEffect, useRef } from 'react';

type Point = { clientX: number; clientY: number };

interface Options {
  /** Hold duration in ms before the menu opens. Default 500. */
  delay?: number;
  /** Finger drift in px that cancels the press (i.e. it was a scroll). Default 10. */
  moveTolerance?: number;
}

/**
 * Touch long-press as the mobile equivalent of right-click.
 *
 * The returned `onClickCapture` is load-bearing: touchend synthesizes a `click`
 * after the press fires, which would otherwise run the tile's normal click
 * handler underneath the menu we just opened (in the media picker that closes
 * the whole modal).
 */
export function useLongPress<T = void>(
  onLongPress: (point: Point, payload: T) => void,
  { delay = 500, moveTolerance = 10 }: Options = {}
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<Point | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const start = startRef.current;
      if (!touch || !start) return;
      const drifted =
        Math.abs(touch.clientX - start.clientX) > moveTolerance ||
        Math.abs(touch.clientY - start.clientY) > moveTolerance;
      if (drifted) clear();
    },
    [moveTolerance, clear]
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!firedRef.current) return;
    firedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handlers for one pressable element. A single hook instance can serve a whole
   * list — only one touch press can be in flight at a time — which is what lets
   * rows inside `DataTable` participate without each owning a hook.
   */
  const bind = useCallback(
    (payload: T) => ({
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        firedRef.current = false;
        startRef.current = { clientX: touch.clientX, clientY: touch.clientY };
        timerRef.current = setTimeout(() => {
          firedRef.current = true;
          navigator.vibrate?.(10);
          onLongPress(startRef.current as Point, payload);
          clear();
        }, delay);
      },
      onTouchMove,
      onTouchEnd: clear,
      onTouchCancel: clear,
      onClickCapture,
    }),
    [onLongPress, delay, clear, onTouchMove, onClickCapture]
  );

  return { bind };
}
