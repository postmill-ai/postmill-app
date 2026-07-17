import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockFetchFn = vi.fn().mockResolvedValue({ ok: true });
const mockMutateFn = vi.fn();

vi.mock('swr', () => ({
  default: vi.fn(),
  useSWRConfig: vi.fn(() => ({ mutate: mockMutateFn })),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div data-testid="loading-component">Loading...</div>,
}));

vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: ({ src, className, alt }: any) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img src={src} className={className} alt={alt} data-testid="safe-image" />
  ),
}));

vi.mock('@gitroom/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: (_type: string, val: string) => val || '',
}));

vi.mock('./comment.thread', () => ({
  CommentThread: () => <div data-testid="comment-thread">CommentThread</div>,
}));

import useSWR from 'swr';
import { PostDetailModal } from './post.detail.modal';

const mockUseSWR = vi.mocked(useSWR);

function basePostData(overrides?: Record<string, any>) {
  return {
    id: 'post-1',
    integration: { id: 'int-1', name: 'Twitter', providerIdentifier: 'twitter' },
    integrationPicture: '/tw.png',
    posts: [
      {
        id: 'pc-1',
        state: 'PUBLISHED',
        content: 'Hello world',
        releaseURL: 'https://twitter.com/status/123',
        releaseId: 'rel-1',
        integration: { id: 'int-1', providerIdentifier: 'twitter' },
      },
    ],
    ...overrides,
  };
}

function baseAnalyticsData() {
  return {
    metrics: {
      views: [{ date: '2024-01-01', value: 100 }],
      likes: [{ date: '2024-01-01', value: 50 }],
    },
  };
}

function stubData({
  postData,
  analyticsData,
  statisticsData,
  postLoading = false,
  analyticsLoading = false,
}: {
  postData?: any;
  analyticsData?: any;
  statisticsData?: any;
  postLoading?: boolean;
  analyticsLoading?: boolean;
}) {
  mockUseSWR.mockReturnValueOnce({
    data: postData,
    error: undefined,
    isLoading: postLoading,
    isValidating: false,
    mutate: vi.fn(),
  } as any);
  mockUseSWR.mockReturnValueOnce({
    data: analyticsData,
    error: undefined,
    isLoading: analyticsLoading,
    isValidating: false,
    mutate: vi.fn(),
  } as any);
  mockUseSWR.mockReturnValueOnce({
    data: statisticsData,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  } as any);
}

describe('PostDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows LoadingComponent when post data is loading', () => {
    stubData({ postLoading: true });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('loading-component')).toBeTruthy();
  });

  it('shows skeleton when analytics data is loading', () => {
    stubData({ postData: basePostData(), analyticsLoading: true });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('kpi-skeleton')).toBeTruthy();
  });

  it('shows "Post not found" when postData is null', () => {
    stubData({ postData: null });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Post not found')).toBeTruthy();
  });

  it('shows "Post not found" when postData is undefined', () => {
    stubData({ postData: undefined });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Post not found')).toBeTruthy();
  });

  it('renders integration avatar from integrationPicture', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    const images = screen.getAllByTestId('safe-image');
    expect(images[0].getAttribute('src')).toBe('/tw.png');
  });

  it('renders provider badge when providerIdentifier exists', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    const images = screen.getAllByTestId('safe-image');
    expect(images[1].getAttribute('src')).toBe('/icons/platforms/twitter.png');
  });

  it('renders post content from the first post', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows "no content" when main post content is empty', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], content: '' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('no content')).toBeTruthy();
  });

  it('renders "Published" pill for PUBLISHED state', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Published')).toBeTruthy();
  });

  it('renders "Scheduled" pill for QUEUE state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'QUEUE' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Scheduled')).toBeTruthy();
  });

  it('renders "Draft" pill for DRAFT state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'DRAFT' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('renders no pill for ERROR state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'ERROR' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Published')).toBeNull();
    expect(screen.queryByText('Scheduled')).toBeNull();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('shows "Open on platform" link when releaseURL exists and is not "missing"', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    const link = screen.getByText('Open on platform');
    expect(link.getAttribute('href')).toBe('https://twitter.com/status/123');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('does not show "Open on platform" when releaseURL is "missing"', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseURL: 'missing' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Open on platform')).toBeNull();
  });

  it('does not show "Open on platform" when releaseURL is absent', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseURL: undefined }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Open on platform')).toBeNull();
  });

  it('renders KPI strip with metric labels and totals', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByText('Likes')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('renders KPI with computed sum from series array', () => {
    const analytics = {
      metrics: {
        impressions: [
          { date: '2024-01-01', value: 200 },
          { date: '2024-01-02', value: 300 },
        ],
      },
    };
    stubData({ postData: basePostData(), analyticsData: analytics });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('500')).toBeTruthy();
  });

  it('does not render KPI strip when metrics object is empty', () => {
    stubData({ postData: basePostData(), analyticsData: { metrics: {} } });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Views')).toBeNull();
    expect(screen.queryByText('Likes')).toBeNull();
  });

  it('does not render KPI strip when analytics data is null', () => {
    stubData({ postData: basePostData(), analyticsData: null });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Views')).toBeNull();
  });

  it('does not render KPI strip when analytics data is undefined', () => {
    stubData({ postData: basePostData(), analyticsData: undefined });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Views')).toBeNull();
  });

  it('limits KPI cards to 8 metrics', () => {
    const manyMetrics: Record<string, any> = {};
    for (let i = 0; i < 12; i++) {
      manyMetrics[`metric_${i}`] = [{ date: '2024-01-01', value: i * 10 }];
    }
    stubData({ postData: basePostData(), analyticsData: { metrics: manyMetrics } });
    render(<PostDetailModal postId="post-1" />);
    const kpiCards = screen.getByText('0').closest('.grid');
    expect(kpiCards?.querySelectorAll('.bg-newTableHeader')).toBeTruthy();
  });

  it('renders thread section when more than one post exists', () => {
    const data = basePostData({
      posts: [
        basePostData().posts[0],
        { id: 'pc-2', state: 'PUBLISHED', content: 'Reply content' },
      ],
    });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Thread')).toBeTruthy();
    expect(screen.getByText('Original post')).toBeTruthy();
    expect(screen.getByText('Reply content')).toBeTruthy();
  });

  it('does not render thread section when only one post exists', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Thread')).toBeNull();
  });

  it('shows "Scheduled / not published" for QUEUE state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'QUEUE' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(
      screen.getByText('Scheduled / not yet published — no engagement yet')
    ).toBeTruthy();
  });

  it('shows "Scheduled / not published" when releaseId is "missing"', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseId: 'missing' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(
      screen.getByText('Scheduled / not yet published — no engagement yet')
    ).toBeTruthy();
  });

  it('shows "Scheduled / not published" when releaseId is absent', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseId: undefined }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(
      screen.getByText('Scheduled / not yet published — no engagement yet')
    ).toBeTruthy();
  });

  it('shows "Scheduled / not published" for DRAFT state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'DRAFT' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(
      screen.getByText('Scheduled / not yet published — no engagement yet')
    ).toBeTruthy();
  });

  it('renders CommentThread for PUBLISHED state with valid releaseId', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('comment-thread')).toBeTruthy();
  });

  it('does not render CommentThread for non-PUBLISHED state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'QUEUE' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByTestId('comment-thread')).toBeNull();
  });

  // 4.6e — mark-read now probes the unread count first, then POSTs read. The
  // POST is deferred behind the awaited probe, so it is not synchronous on mount.
  it('probes unread-count then POSTs mark-read on mount for a published post', async () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    await waitFor(() =>
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/posts/post-1/social-comments/read',
        { method: 'POST' }
      )
    );
    expect(mockFetchFn).toHaveBeenCalledWith(
      '/posts/post-1/social-comments/unread-count'
    );
  });

  // 4.6e — the global calendar mutate must fire only when marking read actually
  // cleared an unread badge.
  it('revalidates the calendar when mark-read cleared unread comments', async () => {
    mockFetchFn
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unreadCount: 3 }) })
      .mockResolvedValueOnce({ ok: true });
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    await waitFor(() => expect(mockMutateFn).toHaveBeenCalled());
  });

  it('does NOT revalidate the calendar when nothing was unread', async () => {
    mockFetchFn
      .mockResolvedValueOnce({ ok: true, json: async () => ({ unreadCount: 0 }) })
      .mockResolvedValueOnce({ ok: true });
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    await waitFor(() =>
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/posts/post-1/social-comments/read',
        { method: 'POST' }
      )
    );
    expect(mockMutateFn).not.toHaveBeenCalled();
  });

  // 4.6e — mark-read must NOT fire for non-published / release-less posts.
  it('does not call mark-read for a DRAFT post', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'DRAFT' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      '/posts/post-1/social-comments/read',
      { method: 'POST' }
    );
  });

  it('does not call mark-read when releaseId is "missing"', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseId: 'missing' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      '/posts/post-1/social-comments/read',
      { method: 'POST' }
    );
  });

  // 4.6d — release URL with a non-http(s) scheme must not become an anchor href.
  it('does not show "Open on platform" when releaseURL has a javascript: scheme', () => {
    const data = basePostData({
      posts: [{ ...basePostData().posts[0], releaseURL: 'javascript:alert(1)' }],
    });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Open on platform')).toBeNull();
  });

  it('does not crash when analytics data is missing entirely', () => {
    stubData({ postData: basePostData(), analyticsData: undefined });
    expect(() => render(<PostDetailModal postId="post-1" />)).not.toThrow();
    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
  });

  it('does not crash when post has no integration', () => {
    const data = basePostData({ integration: undefined, integrationPicture: undefined });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    expect(() => render(<PostDetailModal postId="post-1" />)).not.toThrow();
  });

  it('does not crash when posts array is empty', () => {
    const data = basePostData({ posts: [] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    expect(() => render(<PostDetailModal postId="post-1" />)).not.toThrow();
  });

  it('renders Clicks KPI when statistics data has clicks', () => {
    stubData({
      postData: basePostData(),
      analyticsData: baseAnalyticsData(),
      statisticsData: { clicks: [{ short: 'https://s.co/abc', original: 'https://x.com', clicks: 42 }] },
    });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Clicks')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('does not render Clicks KPI when statistics data has zero clicks', () => {
    stubData({
      postData: basePostData(),
      analyticsData: baseAnalyticsData(),
      statisticsData: { clicks: [{ short: 'https://s.co/abc', original: 'https://x.com', clicks: 0 }] },
    });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Clicks')).toBeNull();
  });

  it('renders Engagement Rate KPI when impressions exist', () => {
    stubData({
      postData: basePostData(),
      analyticsData: {
        metrics: {
          impressions: [{ date: '2024-01-01', value: 1000 }],
          likes: [{ date: '2024-01-01', value: 50 }],
          comments_metric: [{ date: '2024-01-01', value: 20 }],
        },
      },
    });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Engagement Rate')).toBeTruthy();
    expect(screen.getByText('7.0%')).toBeTruthy();
  });

  it('does not render Engagement Rate KPI when impressions are absent', () => {
    stubData({
      postData: basePostData(),
      analyticsData: {
        metrics: {
          views: [{ date: '2024-01-01', value: 500 }],
          likes: [{ date: '2024-01-01', value: 50 }],
        },
      },
    });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Engagement Rate')).toBeNull();
  });

  it('renders sparkline svg for metrics with multiple data points', () => {
    stubData({
      postData: basePostData(),
      analyticsData: {
        metrics: {
          views: [
            { date: '2024-01-01', value: 100 },
            { date: '2024-01-02', value: 200 },
          ],
        },
      },
    });
    render(<PostDetailModal postId="post-1" />);
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });
});
