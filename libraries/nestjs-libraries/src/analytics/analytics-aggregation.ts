// Pure, stateless aggregation/series math extracted from analytics.service.ts
// (5.3). No DI — these are shared by the overview/detail services and the
// facade (which keeps thin private delegators for spec compatibility). Kept
// as plain functions to avoid any DI cycle between the sibling services.

import {
  METRIC_REGISTRY,
  isKnownMetric,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  BestTimeConfidence,
  ContentInsightFinding,
  DerivedMetrics,
  MetricSeries,
  SnapshotLike,
} from './analytics.types';

dayjs.extend(utc);

export function getMetricDef(metric: string) {
  return (
    METRIC_REGISTRY[metric] || {
      label: metric,
      format: 'count',
      kind: 'flow',
    }
  );
}

export function computePercentageChange(
  current: number,
  previous: number | null,
  format: string
): number | null {
  if (previous === null || previous === 0) {
    return current === 0 ? 0 : null;
  }
  if (format === 'percent') {
    return current - previous;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function aggregateSnapshots(
  snapshots: {
    integrationId: string;
    metric: string;
    value: number;
    date: Date;
  }[],
  metric: string
) {
  const def = getMetricDef(metric);
  const grouped: Record<string, number[]> = {};

  for (const row of snapshots) {
    if (row.metric !== metric) continue;
    if (!grouped[row.integrationId]) {
      grouped[row.integrationId] = [];
    }
    grouped[row.integrationId].push(row.value);
  }

  if (def.kind === 'stock') {
    const integrationLatest = Object.values(grouped).map(
      (vals) => vals[vals.length - 1]
    );
    if (def.format === 'percent') {
      if (integrationLatest.length === 0) return 0;
      return (
        integrationLatest.reduce((a, b) => a + b, 0) /
        integrationLatest.length
      );
    }
    return integrationLatest.reduce((a, b) => a + b, 0);
  }

  const allValues = Object.values(grouped).flat();
  if (def.format === 'percent') {
    if (allValues.length === 0) return 0;
    return allValues.reduce((a, b) => a + b, 0) / allValues.length;
  }
  return allValues.reduce((a, b) => a + b, 0);
}

export function buildFilledDayMap(
  snapshots: {
    date: Date;
    metric: string;
    value: number;
    integrationId: string;
  }[],
  metric: string,
  from: Date,
  to: Date,
  kind: string,
  dateOffset: number
): Record<string, number> {
  if (kind === 'stock') {
    const perInt: Record<string, Record<string, number>> = {};
    for (const row of snapshots) {
      if (row.metric !== metric) continue;
      const key = dayjs(row.date).format('YYYY-MM-DD');
      if (!perInt[row.integrationId]) perInt[row.integrationId] = {};
      perInt[row.integrationId][key] = row.value;
    }

    const result: Record<string, number> = {};
    const lastSeen: Record<string, number> = {};
    let cursor = dayjs(from);
    const end = dayjs(to);
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const rawKey = cursor.format('YYYY-MM-DD');
      const outKey = dateOffset
        ? cursor.add(dateOffset, 'day').format('YYYY-MM-DD')
        : rawKey;
      let total = 0;
      for (const intId of Object.keys(perInt)) {
        if (perInt[intId][rawKey] !== undefined) {
          lastSeen[intId] = perInt[intId][rawKey];
        }
        total += lastSeen[intId] || 0;
      }
      result[outKey] = total;
      cursor = cursor.add(1, 'day');
    }
    return result;
  }

  const dayMap: Record<string, number> = {};
  for (const row of snapshots) {
    if (row.metric !== metric) continue;
    const key = dayjs(row.date).format('YYYY-MM-DD');
    dayMap[key] = (dayMap[key] || 0) + row.value;
  }

  const result: Record<string, number> = {};
  let cursor = dayjs(from);
  const end = dayjs(to);
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const rawKey = cursor.format('YYYY-MM-DD');
    const outKey = dateOffset
      ? cursor.add(dateOffset, 'day').format('YYYY-MM-DD')
      : rawKey;
    result[outKey] = dayMap[rawKey] || 0;
    cursor = cursor.add(1, 'day');
  }
  return result;
}

export function buildSparkline(
  snapshots: {
    date: Date;
    metric: string;
    value: number;
    integrationId: string;
  }[],
  metric: string,
  from: Date,
  to: Date
) {
  const def = getMetricDef(metric);
  const dayMap = buildFilledDayMap(snapshots, metric, from, to, def.kind, 0);
  return Object.entries(dayMap).map(([date, value]) => ({ date, value }));
}

export function buildSeries(
  snapshots: {
    date: Date;
    metric: string;
    value: number;
    integrationId: string;
  }[],
  from: Date,
  to: Date
): Record<string, MetricSeries[]> {
  const metrics = [...new Set(snapshots.map((s) => s.metric))].filter(
    isKnownMetric
  );

  const result: Record<string, MetricSeries[]> = {};
  for (const metric of metrics) {
    const def = getMetricDef(metric);
    const dayMap = buildFilledDayMap(snapshots, metric, from, to, def.kind, 0);
    result[metric] = Object.entries(dayMap).map(([date, value]) => ({
      date,
      value,
    }));
  }
  return result;
}

// ── Shared retention-day env parser (ANALYTICS-09/10) ──
export function getRetentionDays(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    Logger.warn(
      `AnalyticsAggregation: invalid ${envKey}="${raw}", falling back to ${fallback}`,
      'AnalyticsAggregation'
    );
    return fallback;
  }
  return Math.floor(parsed);
}

// ── 6.1: campaign-series granularity labelling ──
// Mirrors ANALYTICS_POST_RETENTION_DAYS (analytics.activity.ts). Post snapshots
// older than this are rolled up into weekly rows instead of deleted, so a
// campaign series is daily within the window and weekly beyond it.
export function postSnapshotRetentionDays(): number {
  return getRetentionDays('ANALYTICS_POST_RETENTION_DAYS', 90);
}

// Label each series point 'daily' (within the retention window from now) or
// 'weekly' (older — sourced from rollup rows). Additive/behaviour-neutral: it
// only sets the optional `granularity` field, never touches dates or values.
export function tagSeriesGranularity(
  series: MetricSeries[],
  now: dayjs.Dayjs = dayjs()
): MetricSeries[] {
  const cutoff = now.subtract(postSnapshotRetentionDays(), 'day').startOf('day');
  for (const point of series) {
    point.granularity = dayjs(point.date).isBefore(cutoff) ? 'weekly' : 'daily';
  }
  return series;
}

// ── 6.2: engagement-rate derived metrics (pure, NEVER stored) ──
// Computed on read from the same snapshot rows; both ratios are null when their
// denominator is missing/zero so the UI hides the tile instead of showing 0.
export function computeDerivedMetrics(snapshots: SnapshotLike[]): DerivedMetrics {
  const impressions = aggregateSnapshots(snapshots, 'impressions');
  const likes = aggregateSnapshots(snapshots, 'likes');
  const comments = aggregateSnapshots(snapshots, 'comments');
  const shares = aggregateSnapshots(snapshots, 'shares');
  const reach = aggregateSnapshots(snapshots, 'reach');
  const followers = aggregateSnapshots(snapshots, 'followers');

  return {
    engagementRate:
      impressions > 0 ? (likes + comments + shares) / impressions : null,
    reachPerFollower: followers > 0 ? reach / followers : null,
  };
}

// ── 6.4: sample-size confidence tier for a best-time slot ──
export function bestTimeConfidence(postCount: number): BestTimeConfidence {
  if (postCount >= 10) return 'high';
  if (postCount >= 4) return 'medium';
  if (postCount >= 1) return 'low';
  return 'none';
}

// ── 7.4: content-attribute intelligence ("what works") ──
// Pure, deterministic stats (no ML). Derives attributes from data already on
// each post row, buckets, and compares each bucket's mean engagement against the
// org mean under a minimum-sample guard.
export interface ContentInsightPost {
  // Post.image — a String? holding serialized JSON of media items; parsed
  // defensively (a malformed value yields "no media", never throws).
  image: string | null;
  content: string;
  campaignId: string | null;
  publishDate: Date;
  // engagement = the denormalized sweep counters (lastViews+lastLikes+lastComments)
  engagement: number;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function parsePostMedia(image: string | null): {
  hasVideo: boolean;
  hasImage: boolean;
} {
  if (!image) return { hasVideo: false, hasImage: false };
  let arr: any[] = [];
  try {
    const parsed = JSON.parse(image);
    if (Array.isArray(parsed)) arr = parsed;
  } catch {
    return { hasVideo: false, hasImage: false };
  }
  let hasVideo = false;
  let hasImage = false;
  for (const m of arr) {
    const path = typeof m === 'string' ? m : m?.path || '';
    if (!path) continue;
    if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i.test(path)) hasVideo = true;
    else hasImage = true;
  }
  return { hasVideo, hasImage };
}

function postBuckets(post: ContentInsightPost): Record<string, string> {
  const media = parsePostMedia(post.image);
  const mediaType = media.hasVideo ? 'video' : media.hasImage ? 'image' : 'none';

  const len = post.content?.length || 0;
  const length = len < 100 ? 'short' : len <= 280 ? 'medium' : 'long';

  const hashtags = (post.content?.match(/#[\w]+/g) || []).length;
  const hashtagBucket = hashtags === 0 ? 'none' : hashtags <= 3 ? 'few' : 'many';

  const day = DAY_NAMES[dayjs(post.publishDate).day()];

  return {
    media: mediaType,
    length,
    hashtags: hashtagBucket,
    day,
    campaign: post.campaignId ? 'in-campaign' : 'no-campaign',
  };
}

const DIMENSION_TITLES: Record<string, string> = {
  media: 'media type',
  length: 'content length',
  hashtags: 'hashtag count',
  day: 'day of week',
  campaign: 'campaign membership',
};

export function computeContentInsights(
  posts: ContentInsightPost[],
  opts: { minSample?: number; ratioThreshold?: number } = {}
): { findings: ContentInsightFinding[]; totalPosts: number; orgMean: number } {
  const minSample = opts.minSample ?? 5;
  const ratioThreshold = opts.ratioThreshold ?? 1.15;
  const totalPosts = posts.length;

  if (totalPosts === 0) {
    return { findings: [], totalPosts: 0, orgMean: 0 };
  }

  const orgMean =
    posts.reduce((a, p) => a + (p.engagement || 0), 0) / totalPosts;

  // dimension -> bucket -> { sum, count }
  const dims: Record<string, Record<string, { sum: number; count: number }>> =
    {};
  for (const post of posts) {
    const buckets = postBuckets(post);
    for (const [dim, bucket] of Object.entries(buckets)) {
      if (!dims[dim]) dims[dim] = {};
      if (!dims[dim][bucket]) dims[dim][bucket] = { sum: 0, count: 0 };
      dims[dim][bucket].sum += post.engagement || 0;
      dims[dim][bucket].count += 1;
    }
  }

  const findings: ContentInsightFinding[] = [];
  for (const [dim, buckets] of Object.entries(dims)) {
    for (const [bucket, agg] of Object.entries(buckets)) {
      // Minimum-sample guard: under-sampled buckets are suppressed entirely.
      if (agg.count < minSample) continue;
      const meanEngagement = agg.sum / agg.count;
      // Org mean of 0 → no meaningful ratio; skip.
      if (orgMean <= 0) continue;
      const ratio = meanEngagement / orgMean;
      const direction: 'up' | 'down' = ratio >= 1 ? 'up' : 'down';
      // Only surface notable deltas in either direction.
      if (ratio < ratioThreshold && ratio > 1 / ratioThreshold) continue;

      const dimLabel = DIMENSION_TITLES[dim] || dim;
      const verb = direction === 'up' ? 'outperforms' : 'underperforms';
      const factor =
        direction === 'up'
          ? `${ratio.toFixed(1)}×`
          : `${(1 / ratio).toFixed(1)}× lower`;
      findings.push({
        dimension: dim,
        bucket,
        sampleSize: agg.count,
        meanEngagement,
        orgMean,
        ratio,
        direction,
        title: `${dimLabel} "${bucket}" ${verb} your average (${factor}, ${agg.count} posts)`,
        link: `/analytics?tab=posts`,
      });
    }
  }

  // Rank by strength of deviation from the org mean.
  findings.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
  return { findings, totalPosts, orgMean };
}

// ── R1.2: post-snapshot LEVEL semantics ──
// PostAnalyticsSnapshot.value is a cumulative lifetime level for EVERY metric
// (that is what every provider postAnalytics() returns: X public_metrics,
// Bluesky likeCount, Reddit score, YouTube statistics…). Channel-level
// AnalyticsSnapshot semantics (true dailies for flow metrics) are untouched —
// these helpers exist ONLY for the campaign/post-scoped path, which differences
// levels at read time. `baselines` maps postId → the level just before the
// window (missing ⇒ 0).
export interface PostSnapshotLike {
  postId: string;
  integrationId: string;
  metric: string;
  value: number;
  date: Date;
}

// Windowed total for one metric across a set of post snapshots. Per post the
// contribution is `lastLevelInWindow − baseline(post)`, clamped ≥ 0 (a level can
// dip on unlikes; a window total must not go negative). Percent-format metrics
// (e.g. upvote_ratio) are the AVERAGE of each post's last level — never summed
// or differenced.
export function aggregatePostSnapshotTotal(
  rows: PostSnapshotLike[],
  baselines: Map<string, number>,
  metric: string
): number {
  const def = getMetricDef(metric);
  const lastByPost = new Map<string, { date: Date; value: number }>();
  for (const row of rows) {
    if (row.metric !== metric) continue;
    const cur = lastByPost.get(row.postId);
    // `>= cur.date` so equal-date rows keep the later-seen value (rows arrive
    // ascending, so last-seen wins on a tie).
    if (!cur || !dayjs(row.date).isBefore(dayjs(cur.date))) {
      lastByPost.set(row.postId, { date: row.date, value: row.value });
    }
  }

  if (lastByPost.size === 0) return 0;

  if (def.format === 'percent') {
    const lasts = [...lastByPost.values()].map((v) => v.value);
    return lasts.reduce((a, b) => a + b, 0) / lasts.length;
  }

  let total = 0;
  for (const [postId, last] of lastByPost) {
    const baseline = baselines.get(postId) ?? 0;
    total += Math.max(0, last.value - baseline);
  }
  return total;
}

// Per-day series for one metric under level semantics. Count metrics: per-day
// value = Σ over posts of clamped `(levelOnDay − previousKnownLevel)`, carrying
// the previous known level forward across gap days (previous level seeds from
// the post's baseline). Percent metrics: per-day AVERAGE of that day's carried
// levels. Returns the same zero-filled YYYY-MM-DD → value day-map that
// buildFilledDayMap emits (with the same `dateOffset` shifting for prev-window
// alignment), so it drops into the sparkline/series/prev-map wiring unchanged.
export function buildPostSnapshotSeries(
  rows: PostSnapshotLike[],
  baselines: Map<string, number>,
  metric: string,
  from: Date,
  to: Date,
  dateOffset = 0
): Record<string, number> {
  const def = getMetricDef(metric);

  // postId -> (YYYY-MM-DD -> level). Last write wins per (post, day).
  const perPost: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (row.metric !== metric) continue;
    const key = dayjs(row.date).format('YYYY-MM-DD');
    if (!perPost[row.postId]) perPost[row.postId] = {};
    perPost[row.postId][key] = row.value;
  }

  const result: Record<string, number> = {};
  const end = dayjs(to);

  if (def.format === 'percent') {
    const lastLevel: Record<string, number> = {};
    let cursor = dayjs(from);
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const rawKey = cursor.format('YYYY-MM-DD');
      const outKey = dateOffset
        ? cursor.add(dateOffset, 'day').format('YYYY-MM-DD')
        : rawKey;
      const vals: number[] = [];
      for (const postId of Object.keys(perPost)) {
        if (perPost[postId][rawKey] !== undefined) {
          lastLevel[postId] = perPost[postId][rawKey];
        }
        if (lastLevel[postId] !== undefined) vals.push(lastLevel[postId]);
      }
      result[outKey] =
        vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      cursor = cursor.add(1, 'day');
    }
    return result;
  }

  const prevKnown: Record<string, number> = {};
  for (const postId of Object.keys(perPost)) {
    prevKnown[postId] = baselines.get(postId) ?? 0;
  }

  let cursor = dayjs(from);
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const rawKey = cursor.format('YYYY-MM-DD');
    const outKey = dateOffset
      ? cursor.add(dateOffset, 'day').format('YYYY-MM-DD')
      : rawKey;
    let dayTotal = 0;
    for (const postId of Object.keys(perPost)) {
      const level = perPost[postId][rawKey];
      if (level === undefined) continue; // gap day: carry prev forward, Δ 0
      const delta = level - prevKnown[postId];
      prevKnown[postId] = level;
      dayTotal += Math.max(0, delta);
    }
    result[outKey] = dayTotal;
    cursor = cursor.add(1, 'day');
  }
  return result;
}

export function buildPrevMap(
  snapshots: {
    date: Date;
    metric: string;
    value: number;
    integrationId: string;
  }[],
  prevFrom: Date,
  prevTo: Date,
  dateOffset: number
): Record<string, Record<string, number>> {
  const metrics = [...new Set(snapshots.map((s) => s.metric))].filter(
    isKnownMetric
  );

  const result: Record<string, Record<string, number>> = {};
  for (const metric of metrics) {
    const def = getMetricDef(metric);
    result[metric] = buildFilledDayMap(
      snapshots,
      metric,
      prevFrom,
      prevTo,
      def.kind,
      dateOffset
    );
  }
  return result;
}
