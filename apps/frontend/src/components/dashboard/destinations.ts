'use client';

import { LEGACY_TAB_TO_PATH } from '@postmill-ai/frontend/components/settings/settings-paths';

/**
 * Where dashboard cards and items send you.
 *
 * Kept in one place because these links rotted: several pointed at pages that
 * don't contain the thing they promise (usage → `/billing`, which renders no
 * usage at all), and several went through redirect shims, costing an extra
 * navigation and a flash of the wrong page on every click.
 */

/** The media job queue — counts, filters and per-job actions. */
export const MEDIA_QUEUE_HREF = '/media/queue';

/** Plan usage *and* AI spend/budget. The only surface with both. */
export const ANALYTICS_USAGE_HREF = '/analytics?tab=usage';

/**
 * Rewrite a backend-supplied link to its canonical path.
 *
 * The backend still emits shim URLs, and `/dashboard/summary` + `/dashboard/attention`
 * are Redis-cached, so old payloads keep arriving after a backend fix. Normalising
 * on read means the UI is correct immediately and stays correct for the cache TTL.
 */
export const canonicalPath = (link: string): string => {
  // `/settings?tab=x` → the nested settings route.
  const settingsTab = /^\/settings\?tab=([\w-]+)/.exec(link);
  if (settingsTab) {
    const mapped = LEGACY_TAB_TO_PATH[settingsTab[1]];
    if (mapped) return mapped;
  }
  // `/analytics/v2?...` is a server redirect to `/analytics`.
  if (link.startsWith('/analytics/v2')) {
    return link.replace('/analytics/v2', '/analytics');
  }
  // `/comments` is a redirect to `/replies`, query preserved.
  if (link === '/comments' || link.startsWith('/comments?')) {
    return link.replace('/comments', '/replies');
  }
  return link;
};
