export interface KPI {
  metric: string;
  label: string;
  format: 'number' | 'percent' | 'currency' | 'time';
  total: number;
  previousTotal: number;
  percentageChange: number;
  sparkline: { date: string; value: number }[];
}

export interface SeriesPoint {
  date: string;
  value: number;
  previousValue?: number;
}

// Derived (computed, never stored) secondary metrics (6.2). Either value is
// null when its denominator is zero/missing — the UI hides the tile in that
// case rather than rendering a misleading 0.
export interface DerivedMetrics {
  engagementRate: number | null;
  reachPerFollower: number | null;
}

export interface ChannelKPI {
  integrationId: string;
  name: string;
  identifier: string;
  picture: string;
  kpis: { metric: string; label: string; format: string; total: number; previousTotal: number; percentageChange: number }[];
  value?: number;
  // Per-channel derived metrics (6.2). Present only when the backend can compute
  // at least one; each field may still be null when its denominator is 0.
  derived?: DerivedMetrics;
}

export interface ByPlatform {
  identifier: string;
  value: number;
}

export interface OverviewResponse {
  range: { from: string; to: string };
  kpis: KPI[];
  series: Record<string, SeriesPoint[]>;
  byChannel: ChannelKPI[];
  breakdown: { byPlatform: ByPlatform[] };
  // Org-wide derived metrics (6.2) — engagement rate + reach-per-follower.
  derived?: DerivedMetrics;
  // Present only under a campaign filter (1.3/1.6): metrics derive from post
  // snapshots only, so the UI labels them "post metrics only".
  scope?: 'campaign-posts';
}

export interface ChannelDetailResponse {
  kpis: KPI[];
  series: Record<string, SeriesPoint[]>;
  topPosts: Post[];
}

export interface Post {
  postId: string;
  content: string;
  integration: { id: string; name: string; identifier: string; picture: string };
  publishedAt: string;
  metrics: Record<string, number>;
}

export interface PostsResponse {
  posts: Post[];
  total: number;
}

export interface PostDetail {
  postId: string;
  content: string;
  integration: { id: string; name: string; identifier: string; picture: string };
  publishedAt: string;
  metrics: Record<string, number>;
  series: Record<string, SeriesPoint[]>;
}

export interface MetricDetailResponse {
  metric: string;
  label: string;
  format: 'number' | 'percent' | 'currency' | 'time';
  total: number;
  previousTotal: number;
  percentageChange: number;
  series: SeriesPoint[];
  byChannel: ChannelKPI[];
  topPosts: Post[];
  movers: { up: { integrationId: string; name: string; change: number }[]; down: { integrationId: string; name: string; change: number }[] };
}

export interface DayDetailResponse {
  date: string;
  metric: string;
  value: number;
  byChannel: { integrationId: string; name: string; identifier: string; picture: string; value: number }[];
  posts: Post[];
}

export interface DrillState {
  metric?: string;
  focusIntegration?: string;
  focusDate?: string;
  focusPost?: string;
  tab?: 'overview' | 'channels' | 'posts' | 'insights' | 'best-time' | 'recommendations' | 'watchlist' | 'shortlinks';
}

export interface ChannelMetricResponse {
  metric: string;
  label: string;
  format: 'count' | 'percent' | 'currency';
  total: number;
  previousTotal: number;
  percentageChange: number;
  series: SeriesPoint[];
  topPosts: Post[];
  byDay: { date: string; value: number }[];
}

// `label` stays the English display copy (also the i18next default value);
// `labelKey` is the translation key resolved at each render site via
// `t(labelKey, label)`. This module-level array cannot use hooks, so it is
// NOT translated here — see posts.tab.tsx / alert-rules.modal.tsx /
// alerts.section.tsx for the render-site translation.
export const CANONICAL_METRICS: { key: string; labelKey: string; label: string }[] = [
  { key: 'impressions', labelKey: 'metric_impressions', label: 'Impressions' },
  { key: 'unique_impressions', labelKey: 'metric_unique_impressions', label: 'Unique Impressions' },
  { key: 'reach', labelKey: 'metric_reach', label: 'Reach' },
  { key: 'engagement', labelKey: 'metric_engagement', label: 'Engagement' },
  { key: 'likes', labelKey: 'metric_likes', label: 'Likes' },
  { key: 'comments', labelKey: 'comments', label: 'Comments' },
  { key: 'shares', labelKey: 'metric_shares', label: 'Shares' },
  { key: 'saves', labelKey: 'metric_saves', label: 'Saves' },
  { key: 'replies', labelKey: 'replies', label: 'Replies' },
  { key: 'retweets', labelKey: 'metric_retweets', label: 'Retweets' },
  { key: 'quotes', labelKey: 'metric_quotes', label: 'Quotes' },
  { key: 'bookmarks', labelKey: 'metric_bookmarks', label: 'Bookmarks' },
  { key: 'views', labelKey: 'metric_views', label: 'Views' },
  { key: 'clicks', labelKey: 'clicks', label: 'Clicks' },
  { key: 'followers', labelKey: 'metric_followers', label: 'Followers' },
  { key: 'page_views', labelKey: 'metric_page_views', label: 'Page Views' },
  { key: 'video_views', labelKey: 'metric_video_views', label: 'Video Views' },
  { key: 'minutes_watched', labelKey: 'metric_minutes_watched', label: 'Estimated Minutes Watched' },
  { key: 'avg_view_duration', labelKey: 'metric_avg_view_duration', label: 'Average View Duration' },
  { key: 'avg_view_percentage', labelKey: 'metric_avg_view_percentage', label: 'Average View Percentage' },
  { key: 'subscribers_gained', labelKey: 'metric_subscribers_gained', label: 'Subscribers Gained' },
  { key: 'subscribers_lost', labelKey: 'metric_subscribers_lost', label: 'Subscribers Lost' },
  { key: 'pin_clicks', labelKey: 'metric_pin_clicks', label: 'Pin Clicks' },
  { key: 'pin_click_rate', labelKey: 'metric_pin_click_rate', label: 'Pin Click Rate' },
  { key: 'website_clicks', labelKey: 'metric_website_clicks', label: 'Website Clicks' },
  { key: 'phone_calls', labelKey: 'metric_phone_calls', label: 'Phone Calls' },
  { key: 'direction_requests', labelKey: 'metric_direction_requests', label: 'Direction Requests' },
  { key: 'desktop_map_views', labelKey: 'metric_desktop_map_views', label: 'Desktop Map Views' },
  { key: 'mobile_map_views', labelKey: 'metric_mobile_map_views', label: 'Mobile Map Views' },
  { key: 'organic_followers', labelKey: 'metric_organic_followers', label: 'Organic Followers' },
  { key: 'paid_followers', labelKey: 'metric_paid_followers', label: 'Paid Followers' },
  { key: 'reposts', labelKey: 'metric_reposts', label: 'Reposts' },
  { key: 'post_impressions', labelKey: 'metric_post_impressions', label: 'Post Impressions' },
  { key: 'total_likes', labelKey: 'metric_total_likes', label: 'Total Likes' },
  { key: 'reactions', labelKey: 'metric_reactions', label: 'Reactions' },
  { key: 'outbound_clicks', labelKey: 'metric_outbound_clicks', label: 'Outbound Clicks' },
  { key: 'favorites', labelKey: 'metric_favorites', label: 'Favorites' },
];

// Pattern C helper (fetcher errors, S8) — single source of truth in the shared
// module; re-exported here so analytics-v2/hooks/*.ts can keep importing it from
// '../utils'.
export {
  createFetchError,
  type FetchError,
} from '@gitroom/frontend/components/settings/shared/fetch-error';

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + 'B';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toLocaleString();
}

export function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}
