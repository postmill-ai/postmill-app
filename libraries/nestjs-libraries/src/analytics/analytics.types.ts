// Shared analytics response/DTO shapes and the internal snapshot contract.
// Extracted from analytics.service.ts (5.3) so the facade and its sibling
// services can share them without a circular import. The facade re-exports
// every symbol here, so existing `import … from '.../analytics.service'`
// callers keep working unchanged.

export interface KpiItem {
  metric: string;
  label: string;
  format: string;
  total: number;
  previousTotal: number | null;
  percentageChange: number | null;
  sparkline: { date: string; value: number }[];
}

// Derived, computed-not-stored ratios (6.2). Both are null when their
// denominator is missing/zero (divide-by-zero → null, NOT 0 — a 0 would read
// as "bad" instead of "unknown", and the UI tile hides on null).
export interface DerivedMetrics {
  // (likes + comments + shares) / impressions
  engagementRate: number | null;
  // reach / followers (only when the `followers` stock metric exists)
  reachPerFollower: number | null;
}

export interface ByChannelItem {
  integrationId: string;
  name: string;
  identifier: string;
  picture: string | null;
  kpis: Omit<KpiItem, 'sparkline'>[];
  // 6.2 — secondary derived ratios for this channel.
  derived?: DerivedMetrics;
}

export interface MetricSeries {
  date: string;
  value: number;
  previousValue?: number;
  // 6.1 — under campaign scope, series can span past the post-snapshot
  // retention window: recent points are daily, older ones come from weekly
  // rollup rows. Labeled per point so charts render the daily/weekly seam
  // honestly. Absent (undefined) for the unscoped org overview series.
  granularity?: 'daily' | 'weekly';
}

export interface AnalyticsOverviewResponse {
  range: { from: string; to: string };
  kpis: KpiItem[];
  series: Record<string, MetricSeries[]>;
  byChannel: ByChannelItem[];
  breakdown: { byPlatform: { identifier: string; value: number }[] };
  // 6.2 — org-wide derived ratios (engagement rate, reach-per-follower).
  derived?: DerivedMetrics;
  // Present only under campaign scope (1.3): metrics derive from
  // PostAnalyticsSnapshot joined through Post.campaignId; channel-level
  // AnalyticsSnapshot metrics (followers, page views) are excluded.
  scope?: 'campaign-posts';
}

export interface AnalyticsMetricDetailResponse {
  metric: string;
  label: string;
  format: string;
  total: number;
  previousTotal: number | null;
  percentageChange: number | null;
  series: MetricSeries[];
  byChannel: {
    integrationId: string;
    name: string;
    identifier: string;
    picture: string | null;
    value: number;
    percentageChange: number | null;
    share: number;
  }[];
  topPosts: any[];
  movers: { up: any[]; down: any[] };
}

// The minimal shape the aggregation/series machinery consumes. DB snapshots
// (full Prisma rows) are a superset; live-fallback rows are constructed to it
// directly instead of shape-faking `id`/`createdAt`/`integration` (0.7).
export interface SnapshotLike {
  integrationId: string;
  metric: string;
  value: number;
  date: Date;
}

// Confidence tier for a best-time slot, derived from its post-sample size (6.4)
// so the UI can mute low-sample cells rather than imply false precision.
export type BestTimeConfidence = 'high' | 'medium' | 'low' | 'none';

export interface BestTimeEntry {
  day: number;
  hour: number;
  engagement: number;
  postCount: number;
  avgEngagement: number;
  // 6.4 — sample-size confidence tier (>=10 high, >=4 medium, >=1 low, 0 none).
  confidence?: BestTimeConfidence;
}

// 6.6 — one data-health row per integration (trust surface).
export interface DataHealthItem {
  integrationId: string;
  name: string;
  identifier: string;
  picture: string | null;
  // provider implements analytics() — false = "not supported by <provider>"
  supportsAnalytics: boolean;
  lastSnapshotDate: string | null;
  // window coverage fraction (0..1), reusing the 0.6 distinct-(int,date) heuristic
  coverage: number;
  // no snapshot in the last 48h (only meaningful when supportsAnalytics)
  stale: boolean;
}

// 7.4 — one ranked content-attribute finding ("what works").
export interface ContentInsightFinding {
  dimension: string;
  bucket: string;
  sampleSize: number;
  meanEngagement: number;
  orgMean: number;
  // bucketMean / orgMean (>1 = over-performs, <1 = under-performs)
  ratio: number;
  direction: 'up' | 'down';
  title: string;
  link: string;
}
