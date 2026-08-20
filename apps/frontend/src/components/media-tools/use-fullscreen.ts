'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * "Full screen" for the media studios and the Designer means **fill the browser
 * window**, not the display. It expands the studio over the app's own chrome
 * (left rail, header, media side rail, bottom tab bar) and leaves the browser's
 * tabs and address bar alone.
 *
 * This deliberately does NOT use the Fullscreen API. That took over the whole
 * screen, and it silently did nothing wherever the API is blocked (iframes
 * without `allow="fullscreen"`, some iOS Safari cases) because the CSS that
 * actually expands the panel was driven off `document.fullscreenElement`.
 *
 * The state has to be shared: `FullscreenButton` and each studio root call into
 * this module independently, and separate `useState`s would never agree.
 * Same shape as `useHasOpenModals` in `layout/new-modal.tsx` — private store,
 * one small selector hook — which is what the bottom tab bar already consumes.
 *
 * Single-surface assumption: one boolean for the whole app. Only one studio is
 * normally mounted at a time; the exception is the Designer opened in a modal
 * from the AI Designer chat, where collapsing the Designer also collapses the
 * chat behind it. Benign, and not worth an owner-id + context to avoid.
 */
interface FullscreenState {
  expanded: boolean;
  toggle: () => void;
  exit: () => void;
}

const useFullscreenStore = create<FullscreenState>((set) => ({
  expanded: false,
  toggle: () => set((s) => ({ expanded: !s.expanded })),
  exit: () => set({ expanded: false }),
}));

export function useFullscreen() {
  const isFullscreen = useFullscreenStore((s) => s.expanded);
  const toggle = useFullscreenStore((s) => s.toggle);
  return { isFullscreen, toggle };
}

/** The class applied to an expanded studio root: over everything, under modals (z-200+). */
const EXPANDED_CLASS = 'fixed inset-0 z-100';

/**
 * Root-class hook for a studio surface. Returns `collapsedClass` normally and
 * the expanded overlay class when full screen, and owns the two lifecycle
 * concerns that would otherwise be copy-pasted into all six studio roots:
 * Escape-to-collapse, and resetting on unmount.
 */
export function useFullscreenSurface(collapsedClass: string): string {
  const expanded = useFullscreenStore((s) => s.expanded);
  const exit = useFullscreenStore((s) => s.exit);

  // Navigating away unmounts the studio; without this the app would stay in the
  // expanded state and the mobile bottom bar would remain hidden on the next page.
  useEffect(() => exit, [exit]);

  useEffect(() => {
    if (!expanded) return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Anything modal on screen owns Escape first — the modal manager, and the
      // studios' own overlays (the Designer start dialog, both command palettes),
      // which are all marked role="dialog". Collapsing underneath one of them
      // would fire two actions on a single keypress.
      if (document.querySelector('[role="dialog"]')) return;
      // Typing surfaces own Escape too: the Designer/Replicate command palettes
      // autofocus an input, and so do inline text editing and layer rename.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;

      // Capture phase + stopPropagation, so one Escape collapses the studio
      // without also reaching React's delegated handlers (which would clear the
      // canvas selection at the same time).
      e.preventDefault();
      e.stopPropagation();
      exit();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [expanded, exit]);

  return expanded ? EXPANDED_CLASS : collapsedClass;
}
