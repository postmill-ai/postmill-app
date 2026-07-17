import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlueskyProvider } from '../../../../providers/bluesky/src/v1/social.adapter';
import { MastodonProvider } from '../../../../providers/kernel/src/domains/social-families/mastodon-base';
import { RedditProvider } from '../../../../providers/reddit/src/v1/social.adapter';
import { TelegramProvider } from '../../../../providers/telegram/src/v1/social.adapter';
import { DiscordProvider } from '../../../../providers/discord/src/v1/social.adapter';
import { METRIC_REGISTRY, normalizeMetric } from './analytics.metrics';

// Phase 7.1/7.2 — provider analytics adapters, offline recorded-fixture specs.
// No live network: each provider's HTTP/agent seam is stubbed with a fixture
// captured from the real public API response shape. Two invariants per method:
//   (1) it returns the AnalyticsData[] shape `[{ label, data: [{ total, date }] }]`
//   (2) every emitted label resolves via normalizeMetric() to a METRIC_REGISTRY key
// (the B2 lesson — a metric with no map entry silently drops in the sweep).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertAnalyticsShape(rows: any[], provider: string) {
  expect(Array.isArray(rows)).toBe(true);
  for (const row of rows) {
    expect(typeof row.label).toBe('string');
    expect(row.label.length).toBeGreaterThan(0);
    expect(Array.isArray(row.data)).toBe(true);
    for (const point of row.data) {
      expect(typeof point.total).toBe('string');
      expect(point.date).toMatch(DATE_RE);
    }
    // Every emitted label must map to a canonical registry key.
    const key = normalizeMetric(provider, row.label);
    expect(
      key,
      `[${provider}] label "${row.label}" did not resolve via normalizeMetric`
    ).toBeDefined();
    expect(
      METRIC_REGISTRY[key!],
      `[${provider}] "${row.label}" -> "${key}" not in METRIC_REGISTRY`
    ).toBeDefined();
  }
}

describe('Bluesky analytics (7.1)', () => {
  let provider: BlueskyProvider;
  beforeEach(() => {
    provider = new BlueskyProvider();
  });

  it('analytics() emits Followers from the public appview getProfile', async () => {
    vi.spyOn(provider as any, 'getPublicAgent').mockReturnValue({
      app: {
        bsky: {
          actor: {
            getProfile: async () => ({ data: { followersCount: 4200 } }),
          },
        },
      },
    });

    const rows = await provider.analytics('did:plc:test', 'token', 30);
    assertAnalyticsShape(rows, 'bluesky');
    expect(rows.map((r) => r.label)).toEqual(['Followers']);
    expect(rows[0].data[0].total).toBe('4200');
  });

  it('postAnalytics() emits Likes/Reposts/Replies from getPosts', async () => {
    vi.spyOn(provider as any, 'getPublicAgent').mockReturnValue({
      app: {
        bsky: {
          feed: {
            getPosts: async () => ({
              data: {
                posts: [{ likeCount: 12, repostCount: 3, replyCount: 5 }],
              },
            }),
          },
        },
      },
    });

    const rows = await provider.postAnalytics(
      'integration',
      'token',
      'at://did:plc:test/app.bsky.feed.post/abc',
      Date.now()
    );
    assertAnalyticsShape(rows, 'bluesky');
    expect(rows.map((r) => r.label)).toEqual(['Likes', 'Reposts', 'Replies']);
  });

  it('returns [] when the appview call fails', async () => {
    vi.spyOn(provider as any, 'getPublicAgent').mockReturnValue({
      app: {
        bsky: {
          actor: {
            getProfile: async () => {
              throw new Error('network');
            },
          },
        },
      },
    });
    expect(await provider.analytics('did:plc:test', 'token', 30)).toEqual([]);
  });
});

describe('Mastodon analytics (7.1)', () => {
  let provider: MastodonProvider;
  beforeEach(() => {
    provider = new MastodonProvider();
  });

  it('analytics() emits Followers from the account endpoint', async () => {
    vi.spyOn(provider as any, 'fetch').mockResolvedValue({
      json: async () => ({ id: '1', followers_count: 987 }),
    });

    const rows = await provider.analytics('1', 'token', 30, {
      instanceUrl: 'https://mastodon.social',
    } as any);
    assertAnalyticsShape(rows, 'mastodon');
    expect(rows.map((r) => r.label)).toEqual(['Followers']);
    expect(rows[0].data[0].total).toBe('987');
  });

  it('postAnalytics() emits Favourites/Reblogs/Replies from the status endpoint', async () => {
    vi.spyOn(provider as any, 'fetch').mockResolvedValue({
      json: async () => ({
        id: '9',
        favourites_count: 10,
        reblogs_count: 4,
        replies_count: 2,
      }),
    });

    const rows = await provider.postAnalytics('integration', 'token', '9', 30, {
      instanceUrl: 'https://mastodon.social',
    } as any);
    assertAnalyticsShape(rows, 'mastodon');
    expect(rows.map((r) => r.label)).toEqual([
      'Favourites',
      'Reblogs',
      'Replies',
    ]);
  });
});

describe('Reddit postAnalytics (7.1)', () => {
  let provider: RedditProvider;
  beforeEach(() => {
    provider = new RedditProvider();
  });

  it('emits Score/Upvote Ratio/Comments from /api/info', async () => {
    vi.spyOn(provider as any, 'fetch').mockResolvedValue({
      json: async () => ({
        data: {
          children: [
            {
              kind: 't3',
              data: { score: 321, upvote_ratio: 0.97, num_comments: 45 },
            },
          ],
        },
      }),
    });

    const rows = await provider.postAnalytics('integration', 'token', 't3_abc', 30);
    assertAnalyticsShape(rows, 'reddit');
    expect(rows.map((r) => r.label)).toEqual([
      'Score',
      'Upvote Ratio',
      'Comments',
    ]);
    expect(rows[1].data[0].total).toBe('0.97');
  });

  it('returns [] when the post is missing', async () => {
    vi.spyOn(provider as any, 'fetch').mockResolvedValue({
      json: async () => ({ data: { children: [] } }),
    });
    expect(
      await provider.postAnalytics('integration', 'token', 't3_x', 30)
    ).toEqual([]);
  });
});

describe('Telegram analytics (7.2)', () => {
  let provider: TelegramProvider;
  beforeEach(() => {
    provider = new TelegramProvider();
  });

  it('analytics() emits Followers from getChatMemberCount', async () => {
    vi.spyOn(provider as any, 'createBot').mockReturnValue({
      getChatMemberCount: async () => 5678,
    });

    const rows = await provider.analytics('@channel', '-1001234', 30, {
      client_id: 'bot-token',
    } as any);
    assertAnalyticsShape(rows, 'telegram');
    expect(rows.map((r) => r.label)).toEqual(['Followers']);
    expect(rows[0].data[0].total).toBe('5678');
  });
});

describe('Discord analytics (7.2)', () => {
  let provider: DiscordProvider;
  beforeEach(() => {
    provider = new DiscordProvider();
  });

  it('analytics() emits Members from the guild with_counts endpoint', async () => {
    vi.spyOn(provider as any, 'fetch').mockResolvedValue({
      json: async () => ({
        approximate_member_count: 1500,
        approximate_presence_count: 300,
      }),
    });

    const rows = await provider.analytics('guild-id', 'token', 30, {
      token: 'bot-token',
    } as any);
    assertAnalyticsShape(rows, 'discord');
    expect(rows.map((r) => r.label)).toEqual(['Members']);
    expect(rows[0].data[0].total).toBe('1500');
  });
});
