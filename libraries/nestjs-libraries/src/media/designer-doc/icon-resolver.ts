/**
 * Server-side icon resolver.
 *
 * The Designer's stock browser searches Iconify in the browser, but nothing
 * server-side could turn an icon NAME into markup — so the AI composer had no
 * way to emit a real `icon` element and drew an ellipse stand-in instead. The
 * art director names an icon (`mdi:rocket`); this resolves it to the raw SVG
 * body the `icon` element contract (svg-src.ts) expects.
 *
 * Iconify serves public, immutable, openly-licensed SVGs; fetches go through
 * safeFetch like every other user-influenced outbound call.
 */

import { safeFetch } from '@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch';

const ICONIFY_API = 'https://api.iconify.design';
const MAX_ICON_BYTES = 64 * 1024;

export interface ResolvedIcon {
  /** Inner SVG markup — the value an `icon` element stores in `src`. */
  body: string;
  /** The source viewBox, when the icon is not on Iconify's default grid. */
  viewBox?: string;
}

// Resolved icons are immutable by content address, so a process-level cache
// is safe; bound it so a typo storm cannot grow it without limit.
const ICON_CACHE_MAX = 256;
const iconCache = new Map<string, Promise<ResolvedIcon | null>>();

const NAME_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const fetchIcon = async (name: string): Promise<ResolvedIcon | null> => {
  const match = NAME_RE.exec(name);
  if (!match) return null;
  const [, prefix, icon] = match;

  const res = await safeFetch(`${ICONIFY_API}/${prefix}/${icon}.svg`);
  if (!res.ok) return null;
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_ICON_BYTES) {
    return null;
  }
  const text = await res.text();
  if (text.length > MAX_ICON_BYTES) return null;

  const open = /<svg\b([^>]*)>/.exec(text);
  const bodyMatch = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(text);
  if (!open || !bodyMatch) return null;
  const body = bodyMatch[1].trim();
  // An SVG that can run script is not an icon; refuse it outright.
  if (!body || /<script|on\w+\s*=/i.test(body)) return null;

  const viewBox = /\bviewBox="([^"]+)"/.exec(open[1])?.[1];
  return { body, ...(viewBox ? { viewBox } : {}) };
};

/** Resolve `prefix:name` (e.g. `mdi:rocket`) to raw SVG body, or null. */
export const resolveIconifyIcon = (
  name: string
): Promise<ResolvedIcon | null> => {
  // Real icon names are short; anything longer is garbage that would only
  // grow the cache keys and the outbound URL.
  if (!name || name.length > 200) return Promise.resolve(null);
  const cached = iconCache.get(name);
  if (cached) return cached;
  const promise = fetchIcon(name).catch(() => null);
  iconCache.set(name, promise);
  while (iconCache.size > ICON_CACHE_MAX) {
    const oldest = iconCache.keys().next().value;
    if (oldest === undefined) break;
    iconCache.delete(oldest);
  }
  return promise;
};
