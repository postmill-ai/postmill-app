import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockFetchFn = vi.fn().mockResolvedValue({ ok: true });
const mockMutateFn = vi.fn();
const mockCloseAllFn = vi.fn();

vi.mock('swr', () => ({
  default: vi.fn(),
  useSWRConfig: vi.fn(() => ({ mutate: mockMutateFn })),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div data-testid="loading-component">Loading...</div>,
}));

vi.mock('@postmill-ai/react/helpers/safe.image', () => ({
  default: ({ src, className, alt }: any) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img src={src} className={className} alt={alt} data-testid="safe-image" />
  ),
}));

vi.mock('@postmill-ai/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: (_type: string, val: string) => val || '',
}));

vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn(), closeAll: mockCloseAllFn }),
}));

vi.mock('@postmill-ai/frontend/components/composer/store', () => ({
  useLaunchStore: Object.assign(
    (selector: any) => selector({ current: 'global' }),
    { getState: () => ({ current: 'global', setCurrent: vi.fn() }) }
  ),
}));

vi.mock(
  '@postmill-ai/frontend/components/composer/providers/show.all.providers',
  () => ({ Providers: [] })
);

vi.mock(
  '@postmill-ai/frontend/components/composer/providers/high.order.provider',
  () => ({ getProviderSettingsMeta: () => undefined })
);

// The preview mock renders what the IntegrationContext feeds it, so tests can
// assert on the content/media plumbing without pulling the real composer.
vi.mock(
  '@postmill-ai/frontend/components/launches/general.preview.component',
  async () => {
    const ReactActual = await import('react');
    const { IntegrationContext } = await import(
      '@postmill-ai/frontend/components/launches/helpers/use.integration'
    );
    return {
      GeneralPreviewComponent: () => {
        const { value } = ReactActual.useContext(IntegrationContext);
        return (
          <div data-testid="general-preview">
            {(value || []).map((v: any) => (
              <div key={v.id}>
                <div>{v.content || 'no content'}</div>
                {(v.image || []).map((img: any) => (
                  // eslint-disable-next-line @next/next/no-img-element -- test mock
                  <img
                    key={img.path || img}
                    src={img.path || img}
                    alt="media"
                    data-testid="preview-media"
                  />
                ))}
              </div>
            ))}
          </div>
        );
      },
    };
  }
);

vi.mock('./comment.thread', () => ({
  CommentThread: () => <div data-testid="comment-thread">CommentThread</div>,
}));

import useSWR from 'swr';
import { PostDetailModal } from './post.detail.modal';

const mockUseSWR = vi.mocked(useSWR);

function basePostData(overrides?: Record<string, any>) {
  return {
    id: 'post-1',
    group: 'group-1',
    settings: {},
    integration: { id: 'int-1', name: 'Twitter', providerIdentifier: 'twitter' },
    integrationPicture: '/tw.png',
    posts: [
      {
        id: 'post-1',
        state: 'PUBLISHED',
        content: 'Hello world',
        image: [],
        releaseURL: 'https://twitter.com/status/123',
        releaseId: 'rel-1',
        publishDate: '2024-01-15T12:00:00.000Z',
        integration: { id: 'int-1', name: 'Twitter', providerIdentifier: 'twitter' },
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

// Key-based routing (not call-order) so interactive re-renders (tab switches)
// keep returning the same fixtures. SWR call sites: post detail, analytics,
// statistics, group.
function stubData({
  postData,
  analyticsData,
  statisticsData,
  groupData,
  campaignData,
  teamData,
  postLoading = false,
  analyticsLoading = false,
  postError,
}: {
  postData?: any;
  analyticsData?: any;
  statisticsData?: any;
  groupData?: any;
  campaignData?: any;
  teamData?: any;
  postLoading?: boolean;
  analyticsLoading?: boolean;
  postError?: any;
}) {
  mockUseSWR.mockImplementation((key: any) => {
    const base = { isValidating: false, mutate: vi.fn() };
    if (key === '/posts/post-1') {
      return { ...base, data: postData, error: postError, isLoading: postLoading } as any;
    }
    if (typeof key === 'string' && key.startsWith('/analytics/')) {
      return { ...base, data: analyticsData, error: undefined, isLoading: analyticsLoading } as any;
    }
    if (typeof key === 'string' && key.endsWith('/statistics')) {
      return { ...base, data: statisticsData, error: undefined, isLoading: false } as any;
    }
    if (typeof key === 'string' && key.startsWith('/posts/group/')) {
      return { ...base, data: groupData, error: undefined, isLoading: false } as any;
    }
    if (typeof key === 'string' && key.startsWith('/campaigns/')) {
      return { ...base, data: campaignData, error: undefined, isLoading: false } as any;
    }
    if (key === '/settings/team') {
      return { ...base, data: teamData, error: undefined, isLoading: false } as any;
    }
    return { ...base, data: undefined, error: undefined, isLoading: false } as any;
  });
}

describe('PostDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchFn.mockResolvedValue({ ok: true });
  });

  it('shows a skeleton mirroring the modal layout when post data is loading', () => {
    stubData({ postLoading: true });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('post-detail-skeleton')).toBeTruthy();
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

  it('shows "Post not found" when the post fetch errors', () => {
    stubData({ postData: undefined, postError: new Error('failed_to_load_post') });
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

  it('renders the integration name in the header band', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Twitter')).toBeTruthy();
  });

  it('renders post content through the preview pane', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('general-preview')).toBeTruthy();
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows "no content" in the preview when main post content is empty', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], content: '' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('no content')).toBeTruthy();
  });

  it('renders main-post media in the preview even when the thread has one item', () => {
    const data = basePostData({
      posts: [
        {
          ...basePostData().posts[0],
          image: [{ id: 'm1', path: '/uploads/pic.png' }],
        },
      ],
    });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    const media = screen.getAllByTestId('preview-media');
    expect(media[0].getAttribute('src')).toBe('/uploads/pic.png');
  });

  it('renders every thread item through the preview', () => {
    const data = basePostData({
      posts: [
        basePostData().posts[0],
        { id: 'pc-2', state: 'PUBLISHED', content: 'Reply content', parentPostId: 'post-1', image: [] },
      ],
    });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(screen.getByText('Reply content')).toBeTruthy();
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

  it('renders "Failed" pill and the error banner for ERROR state', () => {
    const data = basePostData({
      posts: [{ ...basePostData().posts[0], state: 'ERROR', error: 'Token expired (demo)' }],
    });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Token expired (demo)')).toBeTruthy();
    expect(screen.queryByText('Published')).toBeNull();
  });

  it('shows a fallback error banner when ERROR has no error text', () => {
    const data = basePostData({
      posts: [{ ...basePostData().posts[0], state: 'ERROR', error: null }],
    });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(
      screen.getByText('An error occurred while publishing this post')
    ).toBeTruthy();
  });

  it('opens the platform URL from the actions menu when releaseURL is valid', () => {
    const openMock = vi.fn();
    const originalOpen = window.open;
    window.open = openMock;
    try {
      stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
      render(<PostDetailModal postId="post-1" />);
      fireEvent.click(screen.getByLabelText('Post actions'));
      fireEvent.click(screen.getByText('Open on platform'));
      expect(openMock).toHaveBeenCalledWith(
        'https://twitter.com/status/123',
        '_blank',
        'noopener,noreferrer'
      );
    } finally {
      window.open = originalOpen;
    }
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

  // 4.6d — release URL with a non-http(s) scheme must not become a link.
  it('does not show "Open on platform" when releaseURL has a javascript: scheme', () => {
    const data = basePostData({
      posts: [{ ...basePostData().posts[0], releaseURL: 'javascript:alert(1)' }],
    });
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

  it('shows the empty analytics note when metrics object is empty', () => {
    stubData({ postData: basePostData(), analyticsData: { metrics: {} } });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Views')).toBeNull();
    expect(screen.queryByText('Likes')).toBeNull();
    expect(screen.getByText('No analytics yet')).toBeTruthy();
  });

  it('shows the empty analytics note when analytics data is null', () => {
    stubData({ postData: basePostData(), analyticsData: null });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Views')).toBeNull();
    expect(screen.getByText('No analytics yet')).toBeTruthy();
  });

  it('shows the empty analytics note when analytics data is undefined', () => {
    stubData({ postData: basePostData(), analyticsData: undefined });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByText('Views')).toBeNull();
    expect(screen.getByText('No analytics yet')).toBeTruthy();
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

  it('shows "Scheduled / not published" for QUEUE state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'QUEUE' }] });
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

  // Published posts never see the "not yet published" empty state — the thread
  // itself reports unsupported/empty channels.
  it('renders CommentThread for PUBLISHED even when releaseId is "missing"', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseId: 'missing' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('comment-thread')).toBeTruthy();
    expect(
      screen.queryByText('Scheduled / not yet published — no engagement yet')
    ).toBeNull();
  });

  it('renders CommentThread for PUBLISHED even when releaseId is absent', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], releaseId: undefined }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.getByTestId('comment-thread')).toBeTruthy();
    expect(
      screen.queryByText('Scheduled / not yet published — no engagement yet')
    ).toBeNull();
  });

  it('does not render CommentThread for non-PUBLISHED state', () => {
    const data = basePostData({ posts: [{ ...basePostData().posts[0], state: 'QUEUE' }] });
    stubData({ postData: data, analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByTestId('comment-thread')).toBeNull();
  });

  it('shows channel tabs for multi-channel groups and switches the preview', () => {
    const groupData = {
      group: 'group-1',
      posts: [
        {
          id: 'post-1',
          state: 'PUBLISHED',
          content: 'Channel A content',
          image: [],
          releaseId: 'rel-1',
          integration: { id: 'int-1', providerIdentifier: 'x', name: 'X Channel', picture: '/x.png' },
        },
        {
          id: 'post-9',
          state: 'PUBLISHED',
          content: 'Channel B content',
          image: [],
          releaseId: 'rel-2',
          integration: { id: 'int-2', providerIdentifier: 'linkedin', name: 'LinkedIn Page', picture: '/li.png' },
        },
      ],
    };
    stubData({
      postData: basePostData(),
      analyticsData: baseAnalyticsData(),
      groupData,
    });
    render(<PostDetailModal postId="post-1" />);

    // The clicked post's channel is first and active.
    expect(screen.getByText('Channel A content')).toBeTruthy();
    expect(screen.queryByText('Channel B content')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /LinkedIn Page/ }));
    expect(screen.getByText('Channel B content')).toBeTruthy();
    expect(screen.queryByText('Channel A content')).toBeNull();
  });

  it('shows no channel tabs for single-channel groups', () => {
    stubData({ postData: basePostData(), analyticsData: baseAnalyticsData() });
    render(<PostDetailModal postId="post-1" />);
    expect(screen.queryByRole('tab')).toBeNull();
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

  describe('details section', () => {
    const detailsPost = (postOverrides?: Record<string, any>) =>
      basePostData({
        posts: [
          {
            id: 'post-1',
            state: 'PUBLISHED',
            content: 'Hello world',
            image: [],
            releaseURL: 'https://twitter.com/status/123',
            releaseId: 'rel-1',
            publishDate: '2024-01-15T12:00:00.000Z',
            createdAt: '2024-01-10T09:00:00.000Z',
            updatedAt: '2024-01-10T09:00:00.000Z',
            creationMethod: 'CLI',
            group: 'group-1',
            integration: {
              id: 'int-1',
              name: 'Twitter',
              providerIdentifier: 'twitter',
            },
            ...postOverrides,
          },
        ],
      });

    it('always renders the post id, created date, and group rows', () => {
      stubData({ postData: detailsPost(), analyticsData: baseAnalyticsData() });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.getByText('Post ID')).toBeTruthy();
      expect(screen.getByText('post-1')).toBeTruthy();
      expect(screen.getByText('Created')).toBeTruthy();
      expect(screen.getByText(/via CLI/)).toBeTruthy();
      expect(screen.getByText('Group')).toBeTruthy();
      expect(screen.getByText('group-1')).toBeTruthy();
    });

    it('shows last updated only when it differs meaningfully from created', () => {
      stubData({
        postData: detailsPost({ updatedAt: '2024-01-12T10:00:00.000Z' }),
        analyticsData: baseAnalyticsData(),
      });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.getByText('Last updated')).toBeTruthy();
    });

    it('omits last updated when it matches created', () => {
      stubData({ postData: detailsPost(), analyticsData: baseAnalyticsData() });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.queryByText('Last updated')).toBeNull();
    });

    it('renders the campaign name when the post belongs to a campaign', () => {
      stubData({
        postData: detailsPost({ campaignId: 'camp-1' }),
        campaignData: { id: 'camp-1', name: 'Winter Drop Launch' },
        analyticsData: baseAnalyticsData(),
      });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.getByText('Campaign')).toBeTruthy();
      expect(screen.getByText('Winter Drop Launch')).toBeTruthy();
    });

    it('renders approval with date and resolved approver name', () => {
      stubData({
        postData: detailsPost({
          approvalStatus: 'approved',
          approvedById: 'user-9',
          approvedAt: '2024-01-14T08:00:00.000Z',
        }),
        teamData: {
          users: [
            { user: { id: 'user-9', email: 'jane@x.com', profile: { name: 'Jane Doe' } } },
          ],
        },
        analyticsData: baseAnalyticsData(),
      });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.getByText('Approval')).toBeTruthy();
      expect(screen.getByText('Approved')).toBeTruthy();
      expect(screen.getByText(/Jane Doe/)).toBeTruthy();
    });

    it('renders the recurring row only for interval posts', () => {
      stubData({
        postData: detailsPost({ intervalInDays: 7 }),
        analyticsData: baseAnalyticsData(),
      });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.getByText('Recurring')).toBeTruthy();
      // The spec's `t` mock returns the fallback verbatim (no interpolation).
      expect(screen.getByText('Repeats every {{count}} days')).toBeTruthy();
    });

    it('omits the recurring row for one-off posts', () => {
      stubData({ postData: detailsPost(), analyticsData: baseAnalyticsData() });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.queryByText('Recurring')).toBeNull();
    });

    it('renders the creator avatar + name when createdById resolves via the team', () => {
      stubData({
        postData: detailsPost({ createdById: 'user-9' }),
        teamData: {
          users: [
            { user: { id: 'user-9', email: 'jane@x.com', profile: { name: 'Jane Doe' } } },
          ],
        },
        analyticsData: baseAnalyticsData(),
      });
      render(<PostDetailModal postId="post-1" />);
      const nameLink = screen.getByText('Jane Doe').closest('a')!;
      expect(nameLink.getAttribute('href')).toBe('/settings');
      expect(screen.getByText('JD')).toBeTruthy();
    });

    it('falls back to date + method only when the creator is not resolvable', () => {
      stubData({ postData: detailsPost(), analyticsData: baseAnalyticsData() });
      render(<PostDetailModal postId="post-1" />);
      expect(screen.getByText('Created')).toBeTruthy();
      expect(screen.queryByText('JD')).toBeNull();
    });

    it('links the release id to the platform URL', () => {
      stubData({ postData: detailsPost(), analyticsData: baseAnalyticsData() });
      render(<PostDetailModal postId="post-1" />);
      const link = screen.getByText('rel-1').closest('a')!;
      expect(link.getAttribute('href')).toBe('https://twitter.com/status/123');
    });
  });
});
