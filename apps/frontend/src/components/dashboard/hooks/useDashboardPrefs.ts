'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface DashboardPrefs {
  hidden: string[];
  v: number;
}

const STORAGE_KEY = 'dashboard_prefs';
const CURRENT_VERSION = 1;
const CHANGE_EVENT = 'dashboard-prefs-change';

const defaultPrefs: DashboardPrefs = { hidden: [], v: CURRENT_VERSION };

function readRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parsePrefs(raw: string | null): DashboardPrefs {
  if (!raw) return defaultPrefs;
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    if (!parsed || typeof parsed !== 'object') return defaultPrefs;
    return {
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((id): id is string => typeof id === 'string')
        : [],
      v: typeof parsed.v === 'number' ? parsed.v : CURRENT_VERSION,
    };
  } catch {
    return defaultPrefs;
  }
}

function writePrefs(prefs: DashboardPrefs) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* ignore persistence failures */
  }
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export const useDashboardPrefs = () => {
  const raw = useSyncExternalStore(
    subscribe,
    readRaw,
    () => null
  );
  const prefs = parsePrefs(raw);

  const toggle = useCallback((id: string) => {
    const current = parsePrefs(readRaw());
    const hidden = new Set(current.hidden);
    if (hidden.has(id)) {
      hidden.delete(id);
    } else {
      hidden.add(id);
    }
    writePrefs({ ...current, hidden: Array.from(hidden) });
  }, []);

  const hide = useCallback((id: string) => {
    const current = parsePrefs(readRaw());
    if (current.hidden.includes(id)) return;
    writePrefs({ ...current, hidden: [...current.hidden, id] });
  }, []);

  const show = useCallback((id: string) => {
    const current = parsePrefs(readRaw());
    if (!current.hidden.includes(id)) return;
    writePrefs({
      ...current,
      hidden: current.hidden.filter((h) => h !== id),
    });
  }, []);

  return {
    prefs,
    hidden: prefs.hidden,
    isHidden: useCallback((id: string) => prefs.hidden.includes(id), [prefs.hidden]),
    toggle,
    hide,
    show,
  };
};
