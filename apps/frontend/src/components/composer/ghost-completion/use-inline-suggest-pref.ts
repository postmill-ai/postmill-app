'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * "Suggest while I type" — per-browser, following the `useDashboardPrefs` /
 * `useSidebarCollapse` pattern rather than a new user-settings column.
 *
 * Default **on** — only an explicit '0' disables it. Suggestions are a metered
 * AI generation, so the spend controls are the ones that don't cost discovery:
 * the minimum draft length, the 1.2s debounce, the prefix cache, the per-mount
 * cap, and the provider's own semantic cache.
 *
 * `useSyncExternalStore` + a CustomEvent keeps the toolbar toggle and the editor
 * hook in step without prop drilling through the editor tree.
 */

const STORAGE_KEY = 'composer_inline_suggest';
const CHANGE_EVENT = 'composer-inline-suggest-change';

const readRaw = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const subscribe = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  // Keep other tabs in step too.
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
};

export const useInlineSuggestPref = () => {
  // The server snapshot is null so SSR and the first client render agree; the
  // stored value arrives on the first subscription tick. null (never set) means
  // on, so only a deliberate opt-out turns it off.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const enabled = raw !== '0';

  const setEnabled = useCallback((next: boolean) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  return { enabled, setEnabled, toggle };
};
