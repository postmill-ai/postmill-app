'use client';

import { useEffect, useState } from 'react';

// Single CSS-var resolver + theme-aware hook for every analytics-v2 chart.
//
// Replaces the copy-pasted-with-divergent-behavior copies in line.chart (correct,
// observed <body>) and area.chart (buggy, observed <html> so it missed the theme
// class that lives on <body>) — F2. bar.chart/pie.chart adopt it too.

/**
 * Resolve a `var(--token, fallback)` string against the live theme. The theme
 * class (.dark/.light) and the `--new-*` tokens are scoped to <body>, so we
 * resolve against <body> (not <html>, which was the area.chart bug).
 */
export function resolveCSSVar(value: string, fallback?: string): string {
  if (typeof document === 'undefined') return fallback ?? value;
  const match = value.match(/^var\(--([^,]+)(?:,\s*([^)]+))?\)$/);
  if (match) {
    const cssVar = `--${match[1]}`;
    const scope = document.body || document.documentElement;
    const computed = getComputedStyle(scope).getPropertyValue(cssVar).trim();
    return computed || match[2]?.trim() || fallback || value;
  }
  return value;
}

/** Resolve a token and re-resolve whenever the theme class on <body> changes. */
export function useCSSToken(token: string, fallback: string): string {
  const [resolved, setResolved] = useState(() => resolveCSSVar(token, fallback));
  useEffect(() => {
    const target = document.body || document.documentElement;
    const observer = new MutationObserver(() => {
      setResolved(resolveCSSVar(token, fallback));
    });
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [token, fallback]);
  return resolved;
}

/** Convert a #rgb/#rrggbb hex to an rgba() string. */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
