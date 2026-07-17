import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricDetailPanel } from './metric.detail.panel';
import { MetricDetailResponse } from '../utils';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

vi.mock('../charts/area.chart', () => ({
  AreaChart: () => <div data-testid="area-chart" />,
}));

vi.mock('chart.js/auto', () => ({
  default: class { destroy() {} },
}));

const fullData: MetricDetailResponse = {
  metric: 'impressions',
  label: 'Impressions',
  format: 'number',
  total: 50000,
  previousTotal: 40000,
  percentageChange: 25,
  series: [
    { date: '2024-01-01', value: 1000 },
    { date: '2024-01-02', value: 2000 },
    { date: '2024-01-03', value: 3000 },
  ],
  byChannel: [
    { integrationId: 'i1', name: 'Twitter', identifier: '@twitter', picture: '/tw.png', value: 30000, kpis: [] },
    { integrationId: 'i2', name: 'LinkedIn', identifier: 'linkedin', picture: '/li.png', value: 20000, kpis: [] },
  ],
  topPosts: [
    {
      postId: 'p1',
      content: 'Top post content',
      integration: { id: 'i1', name: 'Twitter', identifier: '@twitter', picture: '/tw.png' },
      publishedAt: '2024-01-01',
      metrics: { impressions: 1000 },
    },
  ],
  movers: {
    up: [{ integrationId: 'i1', name: 'Twitter', change: 15.5 }],
    down: [{ integrationId: 'i2', name: 'LinkedIn', change: -8.2 }],
  },
};

const baseProps = {
  open: true,
  onClose: vi.fn(),
};

describe('MetricDetailPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MetricDetailPanel {...baseProps} open={false} data={fullData} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no data (loading state)', () => {
    const { container } = render(<MetricDetailPanel {...baseProps} data={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no data (empty state)', () => {
    const { container } = render(<MetricDetailPanel {...baseProps} data={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders metric label, total, percentage change', () => {
    render(<MetricDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('impressions')).toBeTruthy();
    expect(screen.getByText('50,000')).toBeTruthy();
    expect(screen.getByText('25.0%')).toBeTruthy();
  });

  it('shows series area chart', () => {
    render(<MetricDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByTestId('area-chart')).toBeTruthy();
  });

  it('hides chart when series has 1 or fewer points', () => {
    const data: MetricDetailResponse = { ...fullData, series: [{ date: '2024-01-01', value: 1000 }] };
    const { container } = render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(container.querySelector('[data-testid="area-chart"]')).toBeNull();
  });

  it('shows byChannel breakdown with values', () => {
    render(<MetricDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('By Channel')).toBeTruthy();
    const namedChannels = screen.getAllByText(/Twitter|LinkedIn/);
    expect(namedChannels.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('30,000')).toBeTruthy();
    expect(screen.getByText('20,000')).toBeTruthy();
  });

  it('hides byChannel section when empty', () => {
    const data: MetricDetailResponse = { ...fullData, byChannel: [] };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.queryByText('By Channel')).toBeNull();
  });

  it('shows topPosts list', () => {
    render(<MetricDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('Top Posts')).toBeTruthy();
    expect(screen.getByText('Top post content')).toBeTruthy();
    expect(screen.getByText(/Twitter · 1,000/)).toBeTruthy();
  });

  it('hides topPosts section when empty', () => {
    const data: MetricDetailResponse = { ...fullData, topPosts: [] };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.queryByText('Top Posts')).toBeNull();
  });

  it('shows movers up/down', () => {
    render(<MetricDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('Biggest Movers ↑')).toBeTruthy();
    expect(screen.getByText('Biggest Movers ↓')).toBeTruthy();
    const moversUp = screen.getAllByText('+15.5%');
    expect(moversUp.length).toBe(1);
    expect(screen.getByText('-8.2%')).toBeTruthy();
  });

  it('hides movers when either up or down is empty', () => {
    const data: MetricDetailResponse = {
      ...fullData,
      movers: { up: [], down: [{ integrationId: 'i2', name: 'LinkedIn', change: -8.2 }] },
    };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.queryByText('Biggest Movers ↑')).toBeNull();
    expect(screen.queryByText('Biggest Movers ↓')).toBeNull();
  });

  it('displays negative percentage change', () => {
    const data: MetricDetailResponse = {
      ...fullData,
      percentageChange: -16.7,
      total: 2500,
      previousTotal: 3000,
    };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.getByText('16.7%')).toBeTruthy();
  });

  it('renders percent format with pp suffix', () => {
    const data: MetricDetailResponse = {
      ...fullData,
      format: 'percent',
      total: 5.5,
      percentageChange: 2.1,
    };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.getByText('5.5%')).toBeTruthy();
    expect(screen.getByText('2.1pp')).toBeTruthy();
  });

  it('renders currency format', () => {
    const data: MetricDetailResponse = {
      ...fullData,
      format: 'currency',
      total: 1500,
      percentageChange: 10,
    };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.getByText('$1,500.00')).toBeTruthy();
  });

  it('hides percentage change when zero', () => {
    const data: MetricDetailResponse = {
      ...fullData,
      percentageChange: 0,
    };
    render(<MetricDetailPanel {...baseProps} data={data} />);
    expect(screen.queryByText('0.0%')).toBeNull();
  });
});
