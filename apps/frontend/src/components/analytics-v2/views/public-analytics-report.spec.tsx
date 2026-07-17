import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

// StatTile pulls in useCountUp + AreaChart (chart.js); stub to the label only.
vi.mock('../kit/stat-tile', () => ({
  StatTile: ({ kpi }: { kpi: { label: string } }) => (
    <div data-testid="stat-tile">{kpi.label}</div>
  ),
}));

// LineChart is chart.js-backed; stub so the surrounding branch is exercised.
vi.mock('../charts/line.chart', () => ({
  LineChart: () => <div data-testid="line-chart" />,
}));

// ChannelAvatar pulls the brand-icon registry; stub to the name.
vi.mock('../kit/channel-avatar', () => ({
  ChannelAvatar: ({ name }: { name: string }) => (
    <div data-testid="channel-avatar">{name}</div>
  ),
}));

import { PublicAnalyticsReportView } from './public-analytics-report';
import type { PublicAnalyticsReport } from '../hooks/usePublicAnalyticsReport';

const kpi = (over: any = {}) => ({
  metric: 'impressions',
  label: 'Impressions',
  format: 'number' as const,
  total: 1234,
  previousTotal: 1000,
  percentageChange: 23,
  sparkline: [],
  ...over,
});

const baseReport = (over: Partial<PublicAnalyticsReport> = {}): PublicAnalyticsReport =>
  ({
    kpis: [],
    series: {},
    byChannel: [],
    range: { from: '2026-06-01', to: '2026-06-30' },
    ...over,
  } as PublicAnalyticsReport);

describe('PublicAnalyticsReportView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the title and the report date range', () => {
    render(<PublicAnalyticsReportView report={baseReport()} />);
    expect(screen.getByText('Analytics report')).toBeTruthy();
    expect(screen.getByText(/2026-06-01/)).toBeTruthy();
    expect(screen.getByText(/2026-06-30/)).toBeTruthy();
  });

  it('renders one StatTile per KPI', () => {
    render(
      <PublicAnalyticsReportView
        report={baseReport({
          kpis: [kpi(), kpi({ metric: 'likes', label: 'Likes' })],
        })}
      />
    );
    expect(screen.getAllByTestId('stat-tile').length).toBe(2);
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('Likes')).toBeTruthy();
  });

  it('renders no StatTiles and no chart when there are no KPIs', () => {
    const { container } = render(
      <PublicAnalyticsReportView report={baseReport()} />
    );
    expect(container.querySelectorAll('[data-testid="stat-tile"]').length).toBe(0);
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('renders the trend chart when the main metric has a series', () => {
    render(
      <PublicAnalyticsReportView
        report={baseReport({
          kpis: [kpi()],
          series: { impressions: [{ date: '2026-06-01', value: 5 }] },
        })}
      />
    );
    expect(screen.getByTestId('line-chart')).toBeTruthy();
  });

  it('omits the chart when the main metric has no series data', () => {
    render(
      <PublicAnalyticsReportView
        report={baseReport({
          kpis: [kpi()],
          series: { likes: [{ date: '2026-06-01', value: 5 }] },
        })}
      />
    );
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('renders the by-channel section with an avatar and channel KPI total', () => {
    render(
      <PublicAnalyticsReportView
        report={baseReport({
          byChannel: [
            {
              name: 'Twitter',
              identifier: 'x',
              kpis: [{ metric: 'followers', label: 'Followers', total: 4200.6 }],
            },
          ],
        })}
      />
    );
    expect(screen.getByText('By channel')).toBeTruthy();
    expect(screen.getByTestId('channel-avatar')).toBeTruthy();
    // name appears in the avatar stub and the channel-name div
    expect(screen.getAllByText('Twitter').length).toBe(2);
    // total rounded and locale-formatted
    expect(screen.getByText('4,201')).toBeTruthy();
    expect(screen.getByText('Followers')).toBeTruthy();
  });

  it('renders a channel row without a KPI block when the channel has no kpis', () => {
    render(
      <PublicAnalyticsReportView
        report={baseReport({
          byChannel: [{ name: 'Empty', identifier: 'discord', kpis: [] }],
        })}
      />
    );
    expect(screen.getAllByText('Empty').length).toBe(2);
    expect(screen.getByText('discord')).toBeTruthy();
    // no KPI label rendered for this channel
    expect(screen.queryByText('Followers')).toBeNull();
  });

  it('omits the by-channel section entirely when there are no channels', () => {
    render(<PublicAnalyticsReportView report={baseReport()} />);
    expect(screen.queryByText('By channel')).toBeNull();
  });
});
