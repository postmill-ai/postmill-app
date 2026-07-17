import { describe, it, expect } from 'vitest';
import {
  METRIC_REGISTRY,
  PROVIDER_METRIC_MAP,
  normalizeMetric,
  isKnownMetric,
} from './analytics.metrics';

describe('METRIC_REGISTRY', () => {
  it('defines all expected canonical metrics', () => {
    const keys = [
      'impressions', 'unique_impressions', 'reach', 'engagement',
      'likes', 'comments', 'shares', 'saves', 'replies', 'retweets',
      'quotes', 'bookmarks', 'views', 'clicks', 'followers',
      'page_views', 'video_views', 'minutes_watched', 'avg_view_duration',
      'avg_view_percentage', 'subscribers_gained', 'subscribers_lost',
      'pin_clicks', 'pin_click_rate', 'website_clicks', 'phone_calls',
      'direction_requests', 'desktop_map_views', 'mobile_map_views',
      'organic_followers', 'paid_followers', 'reposts',
      'score', 'upvote_ratio',
    ];

    for (const key of keys) {
      expect(METRIC_REGISTRY[key]).toBeDefined();
      expect(METRIC_REGISTRY[key].label).toBeTruthy();
      expect(['flow', 'stock']).toContain(METRIC_REGISTRY[key].kind);
      expect(['count', 'percent', 'currency']).toContain(METRIC_REGISTRY[key].format);
    }
  });

  it('classifies score and upvote_ratio as stock (cumulative levels, R1.1)', () => {
    expect(METRIC_REGISTRY['score'].kind).toBe('stock');
    expect(METRIC_REGISTRY['upvote_ratio'].kind).toBe('stock');
    expect(METRIC_REGISTRY['upvote_ratio'].format).toBe('percent');
  });

  it('has no duplicate labels', () => {
    const labels = Object.values(METRIC_REGISTRY).map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('PROVIDER_METRIC_MAP', () => {
  const providers = ['facebook', 'instagram', 'instagram-standalone', 'linkedin-page', 'tiktok', 'youtube', 'gmb', 'pinterest', 'threads', 'x', 'bluesky', 'mastodon', 'reddit', 'telegram', 'discord'];

  it('covers all expected providers', () => {
    for (const p of providers) {
      expect(PROVIDER_METRIC_MAP[p]).toBeDefined();
    }
  });

  it('every resolved metric exists in METRIC_REGISTRY', () => {
    for (const [provider, mapping] of Object.entries(PROVIDER_METRIC_MAP)) {
      for (const [label, metric] of Object.entries(mapping)) {
        expect(METRIC_REGISTRY[metric], `[${provider}] "${label}" -> "${metric}" not in METRIC_REGISTRY`).toBeDefined();
      }
    }
  });

  it('all provider labels are non-empty strings', () => {
    for (const [provider, mapping] of Object.entries(PROVIDER_METRIC_MAP)) {
      for (const label of Object.keys(mapping)) {
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('normalizeMetric', () => {
  it('resolves facebook labels correctly', () => {
    expect(normalizeMetric('facebook', 'Page Impressions')).toBe('impressions');
    expect(normalizeMetric('facebook', 'Posts Engagement')).toBe('engagement');
    expect(normalizeMetric('facebook', 'Page followers')).toBe('followers');
    expect(normalizeMetric('facebook', 'Videos views')).toBe('video_views');
    // "Posts Impressions" is a distinct page insight from "Page Impressions";
    // they must not collapse onto the same canonical key (data loss).
    expect(normalizeMetric('facebook', 'Posts Impressions')).toBe(
      'post_impressions'
    );
  });

  it('resolves provider post-level labels (postAnalytics) without dropping them', () => {
    // X postAnalytics emits human-readable labels, distinct from the
    // uppercase channel-level labels.
    expect(normalizeMetric('x', 'Impressions')).toBe('impressions');
    expect(normalizeMetric('x', 'Likes')).toBe('likes');
    expect(normalizeMetric('x', 'Bookmarks')).toBe('bookmarks');
    // Facebook postAnalytics labels
    expect(normalizeMetric('facebook', 'Impressions')).toBe('impressions');
    expect(normalizeMetric('facebook', 'Clicks')).toBe('clicks');
    expect(normalizeMetric('facebook', 'Reactions')).toBe('reactions');
    // TikTok postAnalytics labels
    expect(normalizeMetric('tiktok', 'Likes')).toBe('likes');
    expect(normalizeMetric('tiktok', 'Comments')).toBe('comments');
    expect(normalizeMetric('tiktok', 'Shares')).toBe('shares');
    // YouTube postAnalytics labels
    expect(normalizeMetric('youtube', 'Comments')).toBe('comments');
    expect(normalizeMetric('youtube', 'Favorites')).toBe('favorites');
    // Pinterest postAnalytics label
    expect(normalizeMetric('pinterest', 'Outbound Clicks')).toBe(
      'outbound_clicks'
    );
    // Instagram postAnalytics engagement
    expect(normalizeMetric('instagram', 'Engagement')).toBe('engagement');
  });

  it('keeps TikTok lifetime "Total Likes" distinct from recent video likes', () => {
    expect(normalizeMetric('tiktok', 'Total Likes')).toBe('total_likes');
    expect(normalizeMetric('tiktok', 'Recent Likes')).toBe('likes');
  });

  it('resolves instagram labels correctly', () => {
    expect(normalizeMetric('instagram', 'Followers')).toBe('followers');
    expect(normalizeMetric('instagram', 'Reach')).toBe('reach');
    expect(normalizeMetric('instagram', 'Views')).toBe('views');
    expect(normalizeMetric('instagram', 'Likes')).toBe('likes');
    expect(normalizeMetric('instagram', 'Comments')).toBe('comments');
    expect(normalizeMetric('instagram', 'Shares')).toBe('shares');
    expect(normalizeMetric('instagram', 'Saves')).toBe('saves');
    expect(normalizeMetric('instagram', 'Replies')).toBe('replies');
  });

  it('resolves linkedin-page labels correctly', () => {
    expect(normalizeMetric('linkedin-page', 'Page Views')).toBe('page_views');
    expect(normalizeMetric('linkedin-page', 'Clicks')).toBe('clicks');
    expect(normalizeMetric('linkedin-page', 'Shares')).toBe('shares');
    expect(normalizeMetric('linkedin-page', 'Engagement')).toBe('engagement');
    expect(normalizeMetric('linkedin-page', 'Comments')).toBe('comments');
    expect(normalizeMetric('linkedin-page', 'Impressions')).toBe('impressions');
    expect(normalizeMetric('linkedin-page', 'Unique Impressions')).toBe('unique_impressions');
    expect(normalizeMetric('linkedin-page', 'Likes')).toBe('likes');
  });

  it('resolves tiktok labels correctly', () => {
    expect(normalizeMetric('tiktok', 'Followers')).toBe('followers');
    expect(normalizeMetric('tiktok', 'Views')).toBe('views');
    expect(normalizeMetric('tiktok', 'Recent Likes')).toBe('likes');
    expect(normalizeMetric('tiktok', 'Recent Comments')).toBe('comments');
    expect(normalizeMetric('tiktok', 'Recent Shares')).toBe('shares');
  });

  it('resolves youtube labels correctly', () => {
    expect(normalizeMetric('youtube', 'Estimated Minutes Watched')).toBe('minutes_watched');
    expect(normalizeMetric('youtube', 'Average View Duration')).toBe('avg_view_duration');
    expect(normalizeMetric('youtube', 'Average View Percentage')).toBe('avg_view_percentage');
    expect(normalizeMetric('youtube', 'Subscribers Gained')).toBe('subscribers_gained');
    expect(normalizeMetric('youtube', 'Subscribers Lost')).toBe('subscribers_lost');
    expect(normalizeMetric('youtube', 'Likes')).toBe('likes');
  });

  it('resolves gmb labels correctly', () => {
    expect(normalizeMetric('gmb', 'Website Clicks')).toBe('website_clicks');
    expect(normalizeMetric('gmb', 'Phone Calls')).toBe('phone_calls');
    expect(normalizeMetric('gmb', 'Direction Requests')).toBe('direction_requests');
    expect(normalizeMetric('gmb', 'Desktop Map Views')).toBe('desktop_map_views');
    expect(normalizeMetric('gmb', 'Mobile Map Views')).toBe('mobile_map_views');
  });

  it('resolves pinterest labels correctly', () => {
    expect(normalizeMetric('pinterest', 'Pin click rate')).toBe('pin_click_rate');
    expect(normalizeMetric('pinterest', 'Impressions')).toBe('impressions');
    expect(normalizeMetric('pinterest', 'Pin Clicks')).toBe('pin_clicks');
    expect(normalizeMetric('pinterest', 'Engagement')).toBe('engagement');
    expect(normalizeMetric('pinterest', 'Saves')).toBe('saves');
  });

  it('resolves threads labels correctly', () => {
    expect(normalizeMetric('threads', 'Views')).toBe('views');
    expect(normalizeMetric('threads', 'Likes')).toBe('likes');
    expect(normalizeMetric('threads', 'Replies')).toBe('replies');
    expect(normalizeMetric('threads', 'Reposts')).toBe('reposts');
    expect(normalizeMetric('threads', 'Quotes')).toBe('quotes');
  });

  it('resolves dribbble labels to valid METRIC_REGISTRY keys', () => {
    const labels = ['Views', 'Likes', 'Comments', 'Followers', 'Saves'];
    for (const label of labels) {
      const metric = normalizeMetric('dribbble', label);
      expect(metric, `dribbble "${label}" did not resolve`).toBeDefined();
      expect(METRIC_REGISTRY[metric!], `dribbble "${label}" -> "${metric}" not in METRIC_REGISTRY`).toBeDefined();
    }
  });

  it('resolves x labels correctly', () => {
    expect(normalizeMetric('x', 'IMPRESSION')).toBe('impressions');
    expect(normalizeMetric('x', 'BOOKMARK')).toBe('bookmarks');
    expect(normalizeMetric('x', 'LIKE')).toBe('likes');
    expect(normalizeMetric('x', 'QUOTE')).toBe('quotes');
    expect(normalizeMetric('x', 'REPLY')).toBe('replies');
    expect(normalizeMetric('x', 'RETWEET')).toBe('retweets');
  });

  it('resolves bluesky labels correctly (7.1)', () => {
    expect(normalizeMetric('bluesky', 'Followers')).toBe('followers');
    expect(normalizeMetric('bluesky', 'Likes')).toBe('likes');
    expect(normalizeMetric('bluesky', 'Reposts')).toBe('reposts');
    expect(normalizeMetric('bluesky', 'Replies')).toBe('replies');
  });

  it('resolves mastodon labels correctly (7.1)', () => {
    expect(normalizeMetric('mastodon', 'Followers')).toBe('followers');
    expect(normalizeMetric('mastodon', 'Favourites')).toBe('favorites');
    expect(normalizeMetric('mastodon', 'Reblogs')).toBe('reposts');
    expect(normalizeMetric('mastodon', 'Replies')).toBe('replies');
  });

  it('resolves reddit labels correctly (7.1)', () => {
    expect(normalizeMetric('reddit', 'Score')).toBe('score');
    expect(normalizeMetric('reddit', 'Upvote Ratio')).toBe('upvote_ratio');
    expect(normalizeMetric('reddit', 'Comments')).toBe('comments');
  });

  it('resolves telegram/discord labels correctly (7.2)', () => {
    expect(normalizeMetric('telegram', 'Followers')).toBe('followers');
    expect(normalizeMetric('discord', 'Members')).toBe('followers');
  });

  it('returns undefined for unknown label', () => {
    expect(normalizeMetric('facebook', 'nonexistent')).toBeUndefined();
  });

  it('returns undefined for unknown provider', () => {
    expect(normalizeMetric('unknown', 'Impressions')).toBeUndefined();
  });
});

describe('isKnownMetric', () => {
  it('returns true for known metrics', () => {
    expect(isKnownMetric('impressions')).toBe(true);
    expect(isKnownMetric('followers')).toBe(true);
  });

  it('returns false for unknown metrics', () => {
    expect(isKnownMetric('nonexistent')).toBe(false);
  });
});
