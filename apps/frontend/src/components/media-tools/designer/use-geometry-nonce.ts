'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { createDesignerStore, DesignerOutput, DesignerStore } from './designer.store';

type DesignerStoreHook = ReturnType<typeof createDesignerStore>;

/**
 * Trailing debounce for store-driven geometry commits, in ms. Long enough to
 * collapse a burst (arrow-key nudges, rAF-throttled drag frames) into one
 * refresh; short enough that an Inspector edit reads as immediate.
 */
export const GEOMETRY_CACHE_DEBOUNCE_MS = 280;

/**
 * Fingerprint of every element's geometry in the current output.
 *
 * The cached Konva wrappers (StyledLayer / AdjustmentScope / MaskedLayer /
 * LayerGroup) key their caches on everything EXCEPT geometry, so Konva never
 * repaints them when a descendant moves. Gesture commits (dragEnd /
 * transformEnd) bump the nonce immediately, but geometry also changes through
 * the store alone — the Inspector's X/Y/W/H inputs, arrow-key nudges,
 * align/distribute, undo — and those left the cached bitmap frozen at its old
 * position. The subscription below diffs this fingerprint on every store
 * change and schedules a trailing refresh.
 */
export const geometrySignature = (state: DesignerStore): string => {
  const out = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
  return (out?.children || [])
    .map(
      (el) =>
        `${el.id}:${el.x},${el.y},${el.width},${el.height},${el.rotation ?? 0}` +
        `,${el.flipX ? 1 : 0},${el.flipY ? 1 : 0}`
    )
    .join('|');
};

/**
 * Owns the `geometryNonce` folded into the cached wrappers' keys.
 *
 * Three refresh paths, one counter:
 *
 *  1. `bumpGeometryNow` — dragEnd / transformEnd call it directly, so a
 *     gesture's commit repaints in the same frame, with no debounce latency.
 *  2. The store subscription — any OTHER committed geometry change (Inspector
 *     inputs, nudges, align/distribute, undo) refreshes on a trailing debounce.
 *  3. Per drag frame: nothing. The rAF-throttled store writes keep resetting
 *     the debounce, and even if a pause lets the timer fire mid-gesture, the
 *     gesture flag skips it — re-rasterising an effects stack per frame is
 *     the cost the cache keys exist to avoid.
 */
export const useGeometryNonce = (store: DesignerStoreHook) => {
  const [geometryNonce, setGeometryNonce] = useState(0);
  /** True between Konva's dragstart/transformstart and the matching end. */
  const gestureActiveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  /** Immediate refresh for gesture commits; absorbs any pending debounce. */
  const bumpGeometryNow = useCallback(() => {
    cancelDebounce();
    setGeometryNonce((n) => n + 1);
  }, [cancelDebounce]);

  const noteGestureStart = useCallback(() => {
    gestureActiveRef.current = true;
  }, []);

  const noteGestureEnd = useCallback(() => {
    gestureActiveRef.current = false;
  }, []);

  useEffect(() => {
    let last = geometrySignature(store.getState());
    const unsubscribe = store.subscribe((state) => {
      const next = geometrySignature(state);
      if (next === last) return;
      last = next;
      // Trailing edge only: rapid successive commits collapse into one refresh
      // once the burst settles.
      cancelDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        // Mid-gesture the store is written per rAF frame and the gesture's own
        // dragEnd/transformEnd bumps immediately — skip, or a paused drag
        // would rasterise the effects stack with the mouse still down.
        if (gestureActiveRef.current) return;
        setGeometryNonce((n) => n + 1);
      }, GEOMETRY_CACHE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      cancelDebounce();
    };
  }, [store, cancelDebounce]);

  return { geometryNonce, bumpGeometryNow, noteGestureStart, noteGestureEnd };
};
