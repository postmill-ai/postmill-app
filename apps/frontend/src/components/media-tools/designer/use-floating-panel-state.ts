'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FloatingPanelPosition } from './floating-panel';

/**
 * Open state + position for a floating Designer panel, persisted per org.
 *
 * Follows the localStorage convention already used for the Designer's recent
 * colours (`controls/index.tsx`): an org-scoped key, and every read and write
 * wrapped so a quota error or malformed value can never break the editor.
 */

export interface FloatingPanelState extends FloatingPanelPosition {
  open: boolean;
}

const storageKey = (panel: string, orgId?: string | null) =>
  `designer-${panel}-panel${orgId ? `-${orgId}` : ''}`;

const read = (
  panel: string,
  orgId: string | null | undefined,
  fallback: FloatingPanelState
): FloatingPanelState => {
  try {
    const raw = localStorage.getItem(storageKey(panel, orgId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Reject anything that isn't the shape we wrote — a stale or hand-edited
    // value must not put the panel somewhere unreachable.
    if (
      typeof parsed?.x !== 'number' ||
      typeof parsed?.y !== 'number' ||
      typeof parsed?.height !== 'number'
    ) {
      return fallback;
    }
    return {
      x: parsed.x,
      y: parsed.y,
      height: parsed.height,
      open: !!parsed.open,
    };
  } catch {
    return fallback;
  }
};

const write = (
  panel: string,
  orgId: string | null | undefined,
  state: FloatingPanelState
) => {
  try {
    localStorage.setItem(storageKey(panel, orgId), JSON.stringify(state));
  } catch {
    // Private mode / quota exceeded — position just won't persist.
  }
};

export const useFloatingPanelState = (
  panel: string,
  orgId: string | null | undefined,
  defaults: FloatingPanelState
) => {
  // Start from the defaults so server and first client render agree, then adopt
  // the stored value in an effect — reading localStorage during render would
  // hydrate-mismatch.
  const [state, setState] = useState<FloatingPanelState>(defaults);
  const [hydrated, setHydrated] = useState(false);
  // Callers pass an object literal, so `defaults` is a new identity every
  // render; holding it in a ref keeps it out of the effect's dependencies
  // without silencing the lint rule.
  const defaultsRef = useRef(defaults);

  useEffect(() => {
    setState(read(panel, orgId, defaultsRef.current));
    setHydrated(true);
  }, [panel, orgId]);

  useEffect(() => {
    if (!hydrated) return;
    write(panel, orgId, state);
  }, [panel, orgId, state, hydrated]);

  const setPosition = useCallback((next: FloatingPanelPosition) => {
    setState((prev) =>
      prev.x === next.x && prev.y === next.y && prev.height === next.height
        ? prev
        : { ...prev, ...next }
    );
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setState((prev) => (prev.open === open ? prev : { ...prev, open }));
  }, []);

  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, open: !prev.open }));
  }, []);

  return { state, setPosition, setOpen, toggle };
};
