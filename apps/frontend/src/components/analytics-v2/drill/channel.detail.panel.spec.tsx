import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChannelDetailPanel } from './channel.detail.panel';
import { ChannelDetailResponse, ChannelMetricResponse } from '../utils';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

vi.mock('../charts/area.chart', () => ({
  AreaChart: () => <div data-testid="area-chart" />,
}));

vi.mock('../kit/channel-avatar', () => ({
  ChannelAvatar: ({ name }: { name: string }) => (
    <div data-testid="channel-avatar">{name}</div>
  ),
}));

vi.mock('../kit/refresh-button', () => ({
  RefreshButton: ({ integrationId }: { integrationId: string }) => (
    <div data-testid="refresh-button">{integrationId}</div>
  ),
}));

const mockUseChannelMetric = vi.fn();
vi.mock('../hooks/useChannelMetric', () => ({
  useChannelMetric: (...a: any[]) => mockUseChannelMetric(...a),
}));

const channel = {
  integrationId: 'i1',
  name: 'Twitter',
  identifier: '@tw',
  picture: '/p.png',
};

const data: ChannelDetailResponse = {
  kpis: [
    {
      metric: 'impressions',
      label: 'Impressions',
      format: 'number',
      total: 12345,
      previousTotal: 10000,
      percentageChange: 23.4,
      sparkline: [],
    },
    {
      metric: 'engagement',
      label: 'Engagement',
      format: 'percent',
      total: 4.5,
      previousTotal: 4,
      percentageChange: 0,
      sparkline: [],
    },
  ],
  series: {
    impressions: [
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: 200 },
    ],
  },
  topPosts: [
    {
      postId: 'p1',
      content: 'Channel top post',
      integration: { id: 'i1', name: 'Twitter', identifier: '@tw', picture: '/p.png' },
      publishedAt: '2026-01-01',
      metrics: { impressions: 500 },
    },
  ],
};

const metricData: ChannelMetricResponse = {
  metric: 'impressions',
  label: 'Impressions',
  format: 'count',
  total: 9876,
  previousTotal: 8000,
  percentageChange: 12.5,
  series: [
    { date: '2026-01-01', value: 10 },
    { date: '2026-01-02', value: 20 },
  ],
  topPosts: [
    {
      postId: 'mp1',
      content: 'Metric top post',
      integration: { id: 'i1', name: 'Twitter', identifier: '@tw', picture: '/p.png' },
      publishedAt: '2026-01-01',
      metrics: { impressions: 321 },
    },
  ],
  byDay: [
    { date: '2026-01-01', value: 10 },
    { date: '2026-01-02', value: 20 },
  ],
};

const baseProps = {
  channel,
  open: true,
  onClose: vi.fn(),
  from: '2026-01-01',
  to: '2026-01-31',
  compare: true,
};

function stubMetric(over: any = {}) {
  mockUseChannelMetric.mockReturnValue({
    data: undefined,
    isLoading: false,
    ...over,
  });
}

describe('ChannelDetailPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    stubMetric();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ChannelDetailPanel {...baseProps} open={false} data={data} />
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the loading skeleton when data is missing', () => {
    render(<ChannelDetailPanel {...baseProps} data={undefined} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.animate-pulse')).toBeTruthy();
    // Header still shows the channel identity + refresh button.
    expect(screen.getAllByText('Twitter').length).toBeGreaterThan(0);
    expect(screen.getByTestId('refresh-button')).toBeTruthy();
  });

  it('renders KPI cards with formatted values and change badge', () => {
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('12,345')).toBeTruthy();
    // number-format positive change with % suffix
    expect(screen.getByText('23.4%')).toBeTruthy();
    // series has >1 point → area chart
    expect(screen.getByTestId('area-chart')).toBeTruthy();
  });

  it('hides the change badge when percentageChange is zero', () => {
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    // Engagement kpi has percentageChange 0 → no "0.0%" badge
    expect(screen.queryByText('0.0%')).toBeNull();
    // percent-format value renders with % and one decimal
    expect(screen.getByText('4.5%')).toBeTruthy();
  });

  it('renders the channel-level Top Posts section', () => {
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    expect(screen.getByText('Channel top post')).toBeTruthy();
    expect(screen.getAllByText(/Twitter/).length).toBeGreaterThan(0);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<ChannelDetailPanel {...baseProps} data={data} onClose={onClose} />);
    // The close button is the header button next to the refresh button.
    const dialog = screen.getByRole('dialog');
    const closeBtn = dialog.querySelector('button') as HTMLElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('drills into a metric on KPI click and renders the metric detail', () => {
    stubMetric({ data: metricData });
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    fireEvent.click(screen.getByLabelText('View Impressions details'));

    // Drill view: back button, metric total, time series, top posts, by day
    expect(screen.getByText('Back to Twitter')).toBeTruthy();
    expect(screen.getByText('9,876')).toBeTruthy();
    expect(screen.getByText('12.5%')).toBeTruthy();
    expect(screen.getByText('Time Series')).toBeTruthy();
    expect(screen.getByText('Metric top post')).toBeTruthy();
    expect(screen.getByText('By Day')).toBeTruthy();
  });

  it('drills in via keyboard (Enter) on a KPI card', () => {
    stubMetric({ data: metricData });
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    fireEvent.keyDown(screen.getByLabelText('View Impressions details'), {
      key: 'Enter',
    });
    expect(screen.getByText('Back to Twitter')).toBeTruthy();
  });

  it('returns to the KPI list when the Back button is clicked', () => {
    stubMetric({ data: metricData });
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    fireEvent.click(screen.getByLabelText('View Impressions details'));
    fireEvent.click(screen.getByText('Back to Twitter'));
    expect(screen.queryByText('Back to Twitter')).toBeNull();
    expect(screen.getByText('12,345')).toBeTruthy();
  });

  it('Escape closes the inner drill first, then the drawer', () => {
    const onClose = vi.fn();
    stubMetric({ data: metricData });
    render(<ChannelDetailPanel {...baseProps} data={data} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('View Impressions details'));

    // First Escape: clears the drill, does not close.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Back to Twitter')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Second Escape: closes the drawer.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the metric loading skeleton while the drill is fetching', () => {
    stubMetric({ data: undefined, isLoading: true });
    render(<ChannelDetailPanel {...baseProps} data={data} />);
    fireEvent.click(screen.getByLabelText('View Impressions details'));
    const dialog = screen.getByRole('dialog');
    // A second animate-pulse block appears for the loading drill.
    expect(dialog.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
