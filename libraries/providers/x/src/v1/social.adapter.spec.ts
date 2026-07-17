import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must be hoisted above the XProvider import.
vi.mock('twitter-api-v2', () => ({
  TwitterApi: vi.fn(),
}));

import { TwitterApi } from 'twitter-api-v2';
import { XProvider } from './social.adapter';

describe('XProvider analytics pagination', () => {
  const MockedTwitterApi = vi.mocked(TwitterApi);
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DISABLE_X_ANALYTICS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockClient(pages: Array<{ data: { data: Array<{ id: string }> }; meta: { next_token?: string } }>) {
    let callIndex = 0;
    const client = {
      v2: {
        userTimeline: vi.fn(function () {
          const page = pages[callIndex++] ?? { data: { data: [] }, meta: {} };
          return Promise.resolve(page);
        }),
        tweets: vi.fn(function (ids: string[]) {
          return Promise.resolve({
            data: ids.map((id) => ({
              id,
              public_metrics: {
                impression_count: 1,
                bookmark_count: 0,
                like_count: 0,
                quote_count: 0,
                reply_count: 0,
                retweet_count: 0,
              },
            })),
          });
        }),
      },
    };
    MockedTwitterApi.mockImplementation(function () {
      return client as any;
    });
    return client;
  }

  it('stops paginating when the configured max page depth is reached', async () => {
    process.env.X_ANALYTICS_MAX_PAGE_DEPTH = '3';
    const provider = new XProvider();

    // Simulate 5 full pages of results available.
    const pages = Array.from({ length: 5 }, (_, i) => ({
      data: {
        data: Array.from({ length: 100 }, (_, j) => ({ id: `p${i}-${j}` })),
      },
      meta: { next_token: `tok-${i + 1}` },
    }));
    pages[pages.length - 1].meta.next_token = undefined;

    const client = mockClient(pages);

    const result = await provider.analytics('user-1', 'token:secret', 7, {
      client_id: 'app-key',
      client_secret: 'app-secret',
      instanceUrl: 'https://example.com',
    });

    expect(client.v2.userTimeline).toHaveBeenCalledTimes(3);
    expect(result.length).toBeGreaterThan(0);
    expect(client.v2.userTimeline).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ pagination_token: 'tok-2' })
    );
  });

  it('collects all tweets when fewer pages than the max depth exist', async () => {
    process.env.X_ANALYTICS_MAX_PAGE_DEPTH = '5';
    const provider = new XProvider();

    const pages = [
      {
        data: {
          data: Array.from({ length: 100 }, (_, j) => ({ id: `p0-${j}` })),
        },
        meta: { next_token: 'tok-1' },
      },
      {
        data: { data: [{ id: 'last-tweet' }] },
        meta: { next_token: undefined },
      },
    ];

    const client = mockClient(pages);

    await provider.analytics('user-1', 'token:secret', 7, {
      client_id: 'app-key',
      client_secret: 'app-secret',
      instanceUrl: 'https://example.com',
    });

    expect(client.v2.userTimeline).toHaveBeenCalledTimes(2);
    expect(client.v2.tweets).toHaveBeenCalledWith(
      expect.arrayContaining(['p0-0', 'p0-99', 'last-tweet']),
      expect.anything()
    );
  });

  it('uses the default max page depth when no env var is set', async () => {
    delete process.env.X_ANALYTICS_MAX_PAGE_DEPTH;
    const provider = new XProvider();

    const pages = Array.from({ length: 12 }, (_, i) => ({
      data: {
        data: Array.from({ length: 100 }, (_, j) => ({ id: `p${i}-${j}` })),
      },
      meta: { next_token: `tok-${i + 1}` },
    }));
    pages[pages.length - 1].meta.next_token = undefined;

    const client = mockClient(pages);

    await provider.analytics('user-1', 'token:secret', 7, {
      client_id: 'app-key',
      client_secret: 'app-secret',
      instanceUrl: 'https://example.com',
    });

    expect(client.v2.userTimeline).toHaveBeenCalledTimes(10);
  });
});
