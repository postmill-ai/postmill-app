// Canonical metric → display-label lookup for the Campaign Hub, kills the two
// diverging inline maps that used to live in dashboard-kpis.tsx and
// campaign-report-view.tsx (F11). Built from analytics-v2's single source of
// truth (`CANONICAL_METRICS`) plus the few campaign-only goal metrics that the
// analytics catalog doesn't carry (e.g. `posts`).
import { CANONICAL_METRICS } from '@gitroom/frontend/components/analytics-v2/utils';

const LABELS: Record<string, string> = {
  ...Object.fromEntries(CANONICAL_METRICS.map((m) => [m.key, m.label])),
  // Campaign goal-only metrics not present in the analytics catalog.
  posts: 'Posts',
  // Campaign KPI copy: the comments tile/goal reads as "Replies" in the hub.
  comments: 'Replies',
};

export const metricLabel = (metric: string): string => LABELS[metric] || metric;

// Translated variant for the two campaign-only overrides above (module-scope
// literals can't call hooks — callers pass their own `t`). Metrics sourced
// from CANONICAL_METRICS fall back to the plain English label (translated at
// the analytics-v2 layer, out of scope here). Reuses the existing `posts` /
// `replies` keys (same English text used for the campaign dashboard tabs).
export const metricLabelT = (
  metric: string,
  t: (key: string, defaultValue: string) => string
): string => {
  if (metric === 'posts') return t('posts', 'Posts');
  if (metric === 'comments') return t('replies', 'Replies');
  return metricLabel(metric);
};
