import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalyticsDashboard } from './analytics.dashboard';
import { useOverview } from './hooks/useOverview';
import { usePosts } from './hooks/usePosts';
import type { OverviewResponse, PostsResponse } from './utils';

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07');

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('./hooks/useOverview');
vi.mock('./hooks/usePosts');
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => ({
    data: [
      { id: 'i1', name: 'Twitter', identifier: '@twitter', picture: '/tw.png' },
      { id: 'i2', name: 'Instagram', identifier: '@insta', picture: '/ig.png' },
    ],
  }),
}));

vi.mock('./views/overview.tab', () => ({
  OverviewTab: ({ loading, error, onSelectDate }: any) => (
    <div data-testid="overview-tab" data-loading={loading} data-error={!!error}>
      {loading ? 'Loading overview...' : error ? 'Overview error' : 'Overview Content'}
      <button onClick={() => onSelectDate?.('2024-01-05')}>select-date</button>
      <button onClick={() => onSelectDate?.('')}>clear-date</button>
    </div>
  ),
}));

vi.mock('./views/channels.tab', () => ({
  ChannelsTab: ({ loading, error }: any) => (
    <div data-testid="channels-tab" data-loading={loading} data-error={!!error}>
      {loading ? 'Loading channels...' : error ? 'Channels error' : 'Channels Content'}
    </div>
  ),
}));

vi.mock('./views/posts.tab', () => ({
  PostsTab: ({ loading, error }: any) => (
    <div data-testid="posts-tab" data-loading={loading} data-error={!!error}>
      {loading ? 'Loading posts...' : error ? 'Posts error' : 'Posts Content'}
    </div>
  ),
}));

vi.mock('./views/insights.tab', () => ({
  InsightsTab: ({ section }: any) => (
    <div data-testid="insights-tab" data-section={section || ''}>
      Insights Content
    </div>
  ),
}));

// The filter drawer embeds the Mantine range calendar; stub it (no provider in tests).
vi.mock('@mantine/dates', () => ({
  RangeCalendar: () => <div data-testid="range-calendar" />,
}));

// 6.1 — the focusPost deep-link drawer. Stub it so the spec tests wiring, not
// the SWR-driven post detail internals.
vi.mock('./post-analytics.drawer', () => ({
  PostAnalyticsDrawer: ({ postId, open, onClose }: any) =>
    open ? (
      <div data-testid="post-drawer" data-post-id={postId}>
        <button onClick={onClose}>close-drawer</button>
      </div>
    ) : null,
}));

const mockUseOverview = vi.mocked(useOverview);
const mockUsePosts = vi.mocked(usePosts);

// Non-empty by default — the dashboard now hides the overview/channels tab
// content behind its own empty block when the org has no data at all (F9).
const overviewData: OverviewResponse = {
  range: { from: '2024-01-01', to: '2024-01-07' },
  kpis: [
    {
      metric: 'impressions',
      label: 'Impressions',
      format: 'number',
      total: 100,
      previousTotal: 80,
      percentageChange: 25,
      sparkline: [],
    },
  ],
  series: {},
  byChannel: [],
  breakdown: { byPlatform: [] },
};

const emptyOverviewData: OverviewResponse = {
  range: { from: '2024-01-01', to: '2024-01-07' },
  kpis: [],
  series: {},
  byChannel: [],
  breakdown: { byPlatform: [] },
};

const postsData: PostsResponse = {
  posts: [],
  total: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07');

  mockUseOverview.mockReturnValue({
    data: overviewData,
    isLoading: false,
    error: undefined,
    isValidating: false,
    mutate: vi.fn(),
  } as any);

  mockUsePosts.mockReturnValue({
    data: postsData,
    isLoading: false,
    error: undefined,
    isValidating: false,
    mutate: vi.fn(),
  } as any);
});

describe('AnalyticsDashboard', () => {
  it('renders the timeframe filter controls', () => {
    render(<AnalyticsDashboard />);

    expect(screen.getByText('Timeframe')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Month')).toBeTruthy();
    expect(screen.getByText('Compare to previous period')).toBeTruthy();
  });

  it('renders the filter button', () => {
    render(<AnalyticsDashboard />);

    expect(screen.getByRole('button', { name: /^Filter/ })).toBeTruthy();
  });

  it('renders the six inline analytics tab buttons (no kebab)', () => {
    render(<AnalyticsDashboard />);

    // Tabs carry role="tab" (a11y: they live in a role="tablist").
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Channels' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Posts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Insights' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Links' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Watchlist' })).toBeTruthy();
    // Best time / Recommendations are now Insights sections, not top-level tabs.
    expect(screen.queryByRole('tab', { name: 'Best time' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Recommendations' })).toBeNull();
  });

  it('shows InsightsTab when tab=insights', () => {
    mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07&tab=insights');
    render(<AnalyticsDashboard />);
    expect(screen.getByTestId('insights-tab')).toBeTruthy();
  });

  it('maps legacy ?tab=best-time to the Insights tab with a section anchor', () => {
    mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07&tab=best-time');
    render(<AnalyticsDashboard />);
    const insights = screen.getByTestId('insights-tab');
    expect(insights).toBeTruthy();
    expect(insights.getAttribute('data-section')).toBe('best-time');
  });

  it('maps legacy ?tab=recommendations to the Insights tab with a section anchor', () => {
    mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07&tab=recommendations');
    render(<AnalyticsDashboard />);
    const insights = screen.getByTestId('insights-tab');
    expect(insights.getAttribute('data-section')).toBe('recommendations');
  });

  it('shows OverviewTab by default', () => {
    render(<AnalyticsDashboard />);

    expect(screen.getByTestId('overview-tab')).toBeTruthy();
    expect(screen.queryByTestId('channels-tab')).toBeNull();
    expect(screen.queryByTestId('posts-tab')).toBeNull();
  });

  it('shows ChannelsTab when tab=channels', () => {
    mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07&tab=channels');

    render(<AnalyticsDashboard />);

    expect(screen.getByTestId('channels-tab')).toBeTruthy();
    expect(screen.queryByTestId('overview-tab')).toBeNull();
    expect(screen.queryByTestId('posts-tab')).toBeNull();
  });

  it('shows PostsTab when tab=posts', () => {
    mockSearchParams = new URLSearchParams('from=2024-01-01&to=2024-01-07&tab=posts');

    render(<AnalyticsDashboard />);

    expect(screen.getByTestId('posts-tab')).toBeTruthy();
    expect(screen.queryByTestId('overview-tab')).toBeNull();
    expect(screen.queryByTestId('channels-tab')).toBeNull();
  });

  it('passes loading state to the active tab', () => {
    mockUseOverview.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
      isValidating: false,
      mutate: vi.fn(),
    } as any);

    render(<AnalyticsDashboard />);

    const tab = screen.getByTestId('overview-tab');
    expect(tab.getAttribute('data-loading')).toBe('true');
    expect(tab.textContent).toContain('Loading overview...');
  });

  it('threads selected campaigns into the overview fetch (1.6)', () => {
    mockSearchParams = new URLSearchParams(
      'from=2024-01-01&to=2024-01-07&campaigns=c1,c2'
    );

    render(<AnalyticsDashboard />);

    const call = mockUseOverview.mock.calls[mockUseOverview.mock.calls.length - 1][0] as any;
    expect(call.campaigns).toEqual(['c1', 'c2']);
  });

  it('passes the explicit channel filter through unchanged when campaigns are also selected (F4a)', () => {
    // Previously a client-side campaign∩channel intersection could collapse to
    // [] (sent as "no restriction" to the backend); the explicit selection must
    // ride into the fetch untouched — the server intersects campaign posts itself.
    mockSearchParams = new URLSearchParams(
      'from=2024-01-01&to=2024-01-07&integrations=i1&campaigns=c1'
    );

    render(<AnalyticsDashboard />);

    const call = mockUseOverview.mock.calls[mockUseOverview.mock.calls.length - 1][0] as any;
    expect(call.integrations).toEqual(['i1']);
    expect(call.campaigns).toEqual(['c1']);
  });

  it('defaults the metric to the first KPI when a chart point is clicked without one (F8)', () => {
    render(<AnalyticsDashboard />);
    fireEvent.click(screen.getByText('select-date'));
    expect(mockReplace).toHaveBeenCalled();
    const url = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0] as string;
    expect(url).toContain('focusDate=2024-01-05');
    expect(url).toContain('metric=impressions');
  });

  it('keeps an existing drill metric when a chart point is clicked (F8)', () => {
    mockSearchParams = new URLSearchParams(
      'from=2024-01-01&to=2024-01-07&metric=likes'
    );
    render(<AnalyticsDashboard />);
    fireEvent.click(screen.getByText('select-date'));
    const url = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0] as string;
    expect(url).toContain('metric=likes');
  });

  it('clears both focusDate and metric when the day drawer closes (F8)', () => {
    mockSearchParams = new URLSearchParams(
      'from=2024-01-01&to=2024-01-07&focusDate=2024-01-05&metric=impressions'
    );
    render(<AnalyticsDashboard />);
    fireEvent.click(screen.getByText('clear-date'));
    const url = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0] as string;
    expect(url).not.toContain('focusDate');
    expect(url).not.toContain('metric');
  });

  it('shows only the dashboard-level empty block for an empty org (F9)', () => {
    mockUseOverview.mockReturnValue({
      data: emptyOverviewData,
      isLoading: false,
      error: undefined,
      isValidating: false,
      mutate: vi.fn(),
    } as any);

    render(<AnalyticsDashboard />);

    expect(screen.getByText('No analytics data yet')).toBeTruthy();
    // The tab content is suppressed — no second empty state beneath the block.
    expect(screen.queryByTestId('overview-tab')).toBeNull();
  });

  it('shows the campaign-scope note when the overview reports campaign-posts scope (1.6)', () => {
    mockUseOverview.mockReturnValue({
      data: { ...overviewData, scope: 'campaign-posts' },
      isLoading: false,
      error: undefined,
      isValidating: false,
      mutate: vi.fn(),
    } as any);

    render(<AnalyticsDashboard />);
    expect(screen.getByText(/Post metrics only/i)).toBeTruthy();
  });

  it('hides the campaign-scope note when the overview is unscoped', () => {
    render(<AnalyticsDashboard />);
    expect(screen.queryByText(/Post metrics only/i)).toBeNull();
  });

  it('renders the post drawer when ?focusPost is present (6.1)', () => {
    mockSearchParams = new URLSearchParams(
      'from=2024-01-01&to=2024-01-07&focusPost=p1'
    );
    render(<AnalyticsDashboard />);
    const drawer = screen.getByTestId('post-drawer');
    expect(drawer).toBeTruthy();
    expect(drawer.getAttribute('data-post-id')).toBe('p1');
  });

  it('does not render the post drawer without ?focusPost (6.1)', () => {
    render(<AnalyticsDashboard />);
    expect(screen.queryByTestId('post-drawer')).toBeNull();
  });

  it('clears focusPost and metric from the URL when the drawer closes (6.1)', () => {
    mockSearchParams = new URLSearchParams(
      'from=2024-01-01&to=2024-01-07&focusPost=p1&metric=likes'
    );
    render(<AnalyticsDashboard />);
    fireEvent.click(screen.getByText('close-drawer'));
    expect(mockReplace).toHaveBeenCalled();
    const url = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0] as string;
    expect(url).not.toContain('focusPost');
    expect(url).not.toContain('metric');
  });

  it('passes error state to the active tab', () => {
    mockUseOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('API error'),
      isValidating: false,
      mutate: vi.fn(),
    } as any);

    render(<AnalyticsDashboard />);

    const tab = screen.getByTestId('overview-tab');
    expect(tab.getAttribute('data-error')).toBe('true');
    expect(tab.textContent).toContain('Overview error');
  });
});
