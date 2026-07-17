import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewTab } from './overview.tab';
import { OverviewResponse } from '../utils';

vi.mock('../hooks/useCountUp', () => ({
  useCountUp: (target: number) => target,
}));

const mockUseMetricDrill = vi.fn().mockReturnValue({ data: undefined });
const mockUseDayDrill = vi.fn().mockReturnValue({ data: undefined });

vi.mock('../hooks/useMetricDrill', () => ({
  useMetricDrill: (...args: any[]) => mockUseMetricDrill(...args),
}));

vi.mock('../hooks/useDayDrill', () => ({
  useDayDrill: (...args: any[]) => mockUseDayDrill(...args),
}));

// OverviewTab renders the AnomalyOverviewStrip, which reads useAnomalies — stub
// it empty so the strip stays hidden and no real fetch runs in these tests.
vi.mock('../hooks/useAnomalies', () => ({
  useAnomalies: () => ({
    data: [],
    isLoading: false,
    error: undefined,
    dismiss: vi.fn(),
    mutate: vi.fn(),
  }),
}));

vi.mock('chart.js/auto', () => ({
  default: class {
    destroy() {}
  },
}));

const baseProps = {
  from: '2024-01-01',
  to: '2024-01-07',
  integrations: ['i1', 'i2'],
  compare: true,
  onSelectMetric: vi.fn(),
};

const sampleData: OverviewResponse = {
  range: { from: '2024-01-01', to: '2024-01-07' },
  kpis: [
    {
      metric: 'impressions',
      label: 'Impressions',
      format: 'number',
      total: 50000,
      previousTotal: 40000,
      percentageChange: 25,
      sparkline: [
        { date: '2024-01-01', value: 7000 },
        { date: '2024-01-02', value: 8000 },
      ],
    },
    {
      metric: 'engagement',
      label: 'Engagement',
      format: 'number',
      total: 2500,
      previousTotal: 3000,
      percentageChange: -16.7,
      sparkline: [],
    },
  ],
  series: {
    impressions: [
      { date: '2024-01-01', value: 7000 },
      { date: '2024-01-02', value: 8000 },
    ],
  },
  byChannel: [
    {
      integrationId: 'i1',
      name: 'Twitter',
      identifier: '@twitter',
      picture: '/tw.png',
      kpis: [
        {
          metric: 'impressions',
          label: 'Impressions',
          format: 'number',
          total: 30000,
          previousTotal: 20000,
          percentageChange: 50,
        },
      ],
    },
  ],
  breakdown: {
    byPlatform: [{ identifier: 'twitter', value: 50 }],
  },
};

describe('OverviewTab', () => {
  it('renders loading skeletons', () => {
    const { container } = render(
      <OverviewTab {...baseProps} loading={true} />
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    render(
      <OverviewTab
        {...baseProps}
        loading={false}
        error={new Error('API failure')}
      />
    );
    expect(screen.getByText('Failed to load analytics data')).toBeTruthy();
    expect(screen.getByText('API failure')).toBeTruthy();
  });

  it('renders no data state', () => {
    render(<OverviewTab {...baseProps} loading={false} data={undefined} />);
    expect(screen.getByText('No data available yet')).toBeTruthy();
  });

  it('renders empty channels state when no kpis, no channels, and no series', () => {
    render(
      <OverviewTab
        {...baseProps}
        loading={false}
        data={{
          range: { from: '2024-01-01', to: '2024-01-07' },
          kpis: [],
          series: undefined as unknown as Record<string, import('../utils').SeriesPoint[]>,
          byChannel: [],
          breakdown: { byPlatform: [] },
        }}
      />
    );
    expect(screen.getByText('No channels connected')).toBeTruthy();
  });

  it('renders KPI cards from data', () => {
    render(<OverviewTab {...baseProps} loading={false} data={sampleData} />);
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('Engagement')).toBeTruthy();
    expect(screen.getByText('50,000')).toBeTruthy();
    expect(screen.getByText('2,500')).toBeTruthy();
  });

  it('renders chart containers', () => {
    const { container } = render(
      <OverviewTab {...baseProps} loading={false} data={sampleData} />
    );
    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(1);
  });

  it('renders pie and bar chart sections', () => {
    render(<OverviewTab {...baseProps} loading={false} data={sampleData} />);
    expect(screen.getByText('By Platform')).toBeTruthy();
    expect(screen.getByText('Channel Comparison')).toBeTruthy();
  });

  it('calls onSelectMetric when KPI card is clicked', () => {
    const onSelectMetric = vi.fn();
    render(
      <OverviewTab
        {...baseProps}
        loading={false}
        data={sampleData}
        onSelectMetric={onSelectMetric}
      />
    );
    screen.getByText('Impressions').click();
    expect(onSelectMetric).toHaveBeenCalledWith('impressions');
  });

  it('closes metric detail panel via onSelectMetric', () => {
    const onSelectMetric = vi.fn();
    mockUseMetricDrill.mockReturnValue({
      data: {
        metric: 'impressions',
        label: 'Impressions',
        format: 'count',
        total: 50000,
        previousTotal: 40000,
        percentageChange: 25,
        series: [],
        byChannel: [],
        topPosts: [],
        movers: { up: [], down: [] },
      },
    });
    render(
      <OverviewTab
        {...baseProps}
        loading={false}
        data={sampleData}
        selectedMetric="impressions"
        onSelectMetric={onSelectMetric}
      />
    );
    // Target the panel's labelled close button directly — clickable StatTiles
    // are now role="button" (a11y), so the old "first button with an svg"
    // heuristic would match a KPI tile instead.
    const closeBtn = screen.getByRole('button', { name: /close/i });
    closeBtn.click();
    expect(onSelectMetric).toHaveBeenCalledWith('');
  });

  it('suppresses the metric panel while the day drawer is open (F8)', () => {
    // A chart point click sets focusDate + a defaulted metric — only the day
    // drawer may open, not two stacked drawers.
    mockUseMetricDrill.mockReturnValue({
      data: {
        metric: 'impressions',
        label: 'Impressions',
        format: 'count',
        total: 50000,
        previousTotal: 40000,
        percentageChange: 25,
        series: [],
        byChannel: [],
        topPosts: [],
        movers: { up: [], down: [] },
      },
    });
    mockUseDayDrill.mockReturnValue({
      data: {
        date: '2024-01-02',
        metric: 'impressions',
        value: 8000,
        byChannel: [],
        posts: [],
      },
    });
    render(
      <OverviewTab
        {...baseProps}
        loading={false}
        data={sampleData}
        selectedMetric="impressions"
        selectedDate="2024-01-02"
        onSelectDate={vi.fn()}
      />
    );
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    // The one open drawer is the day panel (aria-label = the day's metric).
    expect(dialogs[0].getAttribute('aria-label')).toBe('impressions');
  });
});
