export type MetricKind = 'flow' | 'stock';

export type MetricFormat = 'count' | 'percent' | 'currency';

export interface MetricDef {
  label: string;
  format: MetricFormat;
  kind: MetricKind;
}

export const METRIC_REGISTRY: Record<string, MetricDef> = {
  impressions: { label: 'Impressions', format: 'count', kind: 'flow' },
  unique_impressions: {
    label: 'Unique Impressions',
    format: 'count',
    kind: 'flow',
  },
  reach: { label: 'Reach', format: 'count', kind: 'flow' },
  engagement: { label: 'Engagement', format: 'count', kind: 'flow' },
  likes: { label: 'Likes', format: 'count', kind: 'flow' },
  comments: { label: 'Comments', format: 'count', kind: 'flow' },
  shares: { label: 'Shares', format: 'count', kind: 'flow' },
  saves: { label: 'Saves', format: 'count', kind: 'flow' },
  replies: { label: 'Replies', format: 'count', kind: 'flow' },
  retweets: { label: 'Retweets', format: 'count', kind: 'flow' },
  quotes: { label: 'Quotes', format: 'count', kind: 'flow' },
  bookmarks: { label: 'Bookmarks', format: 'count', kind: 'flow' },
  views: { label: 'Views', format: 'count', kind: 'flow' },
  clicks: { label: 'Clicks', format: 'count', kind: 'flow' },
  followers: { label: 'Followers', format: 'count', kind: 'stock' },
  page_views: { label: 'Page Views', format: 'count', kind: 'flow' },
  video_views: { label: 'Video Views', format: 'count', kind: 'flow' },
  minutes_watched: {
    label: 'Estimated Minutes Watched',
    format: 'count',
    kind: 'flow',
  },
  avg_view_duration: {
    label: 'Average View Duration',
    format: 'count',
    kind: 'flow',
  },
  avg_view_percentage: {
    label: 'Average View Percentage',
    format: 'percent',
    kind: 'flow',
  },
  subscribers_gained: {
    label: 'Subscribers Gained',
    format: 'count',
    kind: 'flow',
  },
  subscribers_lost: {
    label: 'Subscribers Lost',
    format: 'count',
    kind: 'flow',
  },
  pin_clicks: { label: 'Pin Clicks', format: 'count', kind: 'flow' },
  pin_click_rate: { label: 'Pin click rate', format: 'percent', kind: 'flow' },
  website_clicks: { label: 'Website Clicks', format: 'count', kind: 'flow' },
  phone_calls: { label: 'Phone Calls', format: 'count', kind: 'flow' },
  direction_requests: {
    label: 'Direction Requests',
    format: 'count',
    kind: 'flow',
  },
  desktop_map_views: {
    label: 'Desktop Map Views',
    format: 'count',
    kind: 'flow',
  },
  mobile_map_views: {
    label: 'Mobile Map Views',
    format: 'count',
    kind: 'flow',
  },
  organic_followers: {
    label: 'Organic Followers',
    format: 'count',
    kind: 'flow',
  },
  paid_followers: { label: 'Paid Followers', format: 'count', kind: 'flow' },
  reposts: { label: 'Reposts', format: 'count', kind: 'flow' },
  // Distinct keys to avoid collapsing semantically different provider labels
  // onto the same (integrationId, metric, date) snapshot key.
  post_impressions: { label: 'Post Impressions', format: 'count', kind: 'flow' },
  total_likes: { label: 'Total Likes', format: 'count', kind: 'stock' },
  reactions: { label: 'Reactions', format: 'count', kind: 'flow' },
  outbound_clicks: { label: 'Outbound Clicks', format: 'count', kind: 'flow' },
  favorites: { label: 'Favorites', format: 'count', kind: 'flow' },
  // Reddit per-post metrics (7.1): net score and the upvote ratio are distinct
  // from likes/engagement — keep them on their own canonical keys so they
  // don't collapse onto a semantically different metric.
  // Levels even in isolation (net score, point-in-time ratio) — cumulative like
  // total_likes (kind:'stock'), not per-window flows. Post-snapshot consumers
  // difference them at read time.
  score: { label: 'Score', format: 'count', kind: 'stock' },
  upvote_ratio: { label: 'Upvote Ratio', format: 'percent', kind: 'stock' },
};

export const PROVIDER_METRIC_MAP: Record<string, Record<string, string>> = {
  facebook: {
    // Channel-level (analytics)
    'Page Impressions': 'impressions',
    'Posts Engagement': 'engagement',
    'Page followers': 'followers',
    'Videos views': 'video_views',
    'Posts Impressions': 'post_impressions',
    // Post-level (postAnalytics)
    Impressions: 'impressions',
    Clicks: 'clicks',
    Reactions: 'reactions',
  },
  instagram: {
    Likes: 'likes',
    Comments: 'comments',
    Shares: 'shares',
    Saves: 'saves',
    Replies: 'replies',
    Reach: 'reach',
    Views: 'views',
    Followers: 'followers',
    'Follower Count': 'followers',
    Engagement: 'engagement',
  },
  'instagram-standalone': {
    Likes: 'likes',
    Comments: 'comments',
    Shares: 'shares',
    Saves: 'saves',
    Replies: 'replies',
    Reach: 'reach',
    Views: 'views',
    Followers: 'followers',
    'Follower Count': 'followers',
    Engagement: 'engagement',
  },
  'linkedin-page': {
    'Page Views': 'page_views',
    Clicks: 'clicks',
    Shares: 'shares',
    Engagement: 'engagement',
    Comments: 'comments',
    'Organic Followers': 'organic_followers',
    'Paid Followers': 'paid_followers',
    Impressions: 'impressions',
    'Unique Impressions': 'unique_impressions',
    Likes: 'likes',
  },
  tiktok: {
    // Channel-level (analytics)
    Followers: 'followers',
    'Total Likes': 'total_likes',
    Views: 'views',
    'Recent Likes': 'likes',
    'Recent Comments': 'comments',
    'Recent Shares': 'shares',
    // Post-level (postAnalytics)
    Likes: 'likes',
    Comments: 'comments',
    Shares: 'shares',
  },
  youtube: {
    'Estimated Minutes Watched': 'minutes_watched',
    'Average View Duration': 'avg_view_duration',
    'Average View Percentage': 'avg_view_percentage',
    'Subscribers Gained': 'subscribers_gained',
    'Subscribers Lost': 'subscribers_lost',
    Likes: 'likes',
    Views: 'views',
    // Post-level (postAnalytics)
    Comments: 'comments',
    Favorites: 'favorites',
  },
  gmb: {
    'Website Clicks': 'website_clicks',
    'Phone Calls': 'phone_calls',
    'Direction Requests': 'direction_requests',
    'Desktop Map Views': 'desktop_map_views',
    'Mobile Map Views': 'mobile_map_views',
  },
  pinterest: {
    'Pin click rate': 'pin_click_rate',
    Impressions: 'impressions',
    'Pin Clicks': 'pin_clicks',
    Engagement: 'engagement',
    Saves: 'saves',
    // Post-level (postAnalytics)
    'Outbound Clicks': 'outbound_clicks',
  },
  threads: {
    Views: 'views',
    Likes: 'likes',
    Replies: 'replies',
    Reposts: 'reposts',
    Quotes: 'quotes',
  },
  dribbble: {
    // Dribbble API v2 stats (shot views/likes/comments, user followers, buckets).
    Views: 'views',
    Likes: 'likes',
    Comments: 'comments',
    Followers: 'followers',
    Saves: 'saves',
  },
  x: {
    // Channel-level (analytics) — labels are derived via key.toUpperCase()
    IMPRESSION: 'impressions',
    BOOKMARK: 'bookmarks',
    LIKE: 'likes',
    QUOTE: 'quotes',
    REPLY: 'replies',
    RETWEET: 'retweets',
    // Post-level (postAnalytics) — human-readable labels
    Impressions: 'impressions',
    Likes: 'likes',
    Retweets: 'retweets',
    Replies: 'replies',
    Quotes: 'quotes',
    Bookmarks: 'bookmarks',
  },
  // --- Phase 7.1 (wave 1) ---
  bluesky: {
    // Channel-level (analytics) — public appview getProfile
    Followers: 'followers',
    // Post-level (postAnalytics) — public appview getPosts
    Likes: 'likes',
    Reposts: 'reposts',
    Replies: 'replies',
  },
  mastodon: {
    // Channel-level (analytics) — account followers_count
    Followers: 'followers',
    // Post-level (postAnalytics) — status favourites/reblogs/replies counts
    Favourites: 'favorites',
    Reblogs: 'reposts',
    Replies: 'replies',
  },
  reddit: {
    // Post-level only (postAnalytics) — Reddit exposes no per-account channel
    // analytics; subreddit-agnostic per-post metrics via /api/info.
    Score: 'score',
    'Upvote Ratio': 'upvote_ratio',
    Comments: 'comments',
  },
  // --- Phase 7.2 (wave 2) ---
  telegram: {
    // Channel-level (analytics) — getChatMemberCount. Per-post `views` require
    // MTProto (not the Bot API) — documented BLOCKED in su-provider-analytics.md.
    Followers: 'followers',
  },
  discord: {
    // Channel-level (analytics) — guild approximate_member_count.
    Members: 'followers',
  },
};

export function normalizeMetric(
  provider: string,
  label: string
): string | undefined {
  return PROVIDER_METRIC_MAP[provider]?.[label];
}

export function isKnownMetric(metric: string): boolean {
  return metric in METRIC_REGISTRY;
}
