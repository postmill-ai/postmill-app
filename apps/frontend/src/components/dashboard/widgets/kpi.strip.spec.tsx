import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { KpiStrip } from './kpi.strip';
import type { KPI } from '@gitroom/frontend/components/analytics-v2/utils';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback: string, vars?: Record<string, string>) => {
    let text = fallback ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
      });
    }
    return text;
  },
}));

vi.mock('@gitroom/frontend/components/analytics-v2/hooks/useCountUp', () => ({
  useCountUp: (target: number) => target,
}));

vi.mock('@gitroom/frontend/components/analytics-v2/charts/area.chart', () => ({
  AreaChart: () => <div data-testid="area-chart" />,
}));

vi.mock('../hooks/useDashboardSummary', () => ({
  useDashboardSummary: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/hooks/useOverview', () => ({
  useOverview: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { useOverview } from '@gitroom/frontend/components/analytics-v2/hooks/useOverview';

const mockUseDashboardSummary = useDashboardSummary as unknown as ReturnType<typeof vi.fn>;
const mockUseOverview = useOverview as unknown as ReturnType<typeof vi.fn>;

const defaultProps = {
  from: '2024-01-01',
  to: '2024-01-07',
  integrationIds: ['a', 'b', 'c'],
};

function makeKpi(overrides: Partial<KPI> = {}): KPI {
  return {
    metric: 'Engagement (7d)',
    label: 'Engagement (7d)',
    format: 'number',
    total: 1234,
    previousTotal: 0,
    percentageChange: 0,
    sparkline: [],
    ...overrides,
  };
}

describe('KpiStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDashboardSummary.mockReturnValue({ data: undefined, isLoading: true });
    mockUseOverview.mockReturnValue({ data: undefined, isLoading: true });
  });

  it('renders skeleton placeholders while loading', () => {
    render(<KpiStrip {...defaultProps} />);

    expect(screen.getByText('Engagement (7d)')).toBeTruthy();
    expect(screen.getByText('Published (7d)')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('Unread replies')).toBeTruthy();
    expect(screen.getByText('Channels')).toBeTruthy();

    const pulses = document.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBe(2);
  });

  it('renders expected content and values when data is loaded', () => {
    mockUseDashboardSummary.mockReturnValue({
      data: {
        publishedNext7: 12,
        scheduledPosts: 34,
        commentUnreadCount: 5,
        channelsConnected: 7,
      },
      isLoading: false,
    });
    mockUseOverview.mockReturnValue({
      data: { kpis: [makeKpi({ total: 1234, percentageChange: 5.5, sparkline: [{ date: '2024-01-01', value: 1 }, { date: '2024-01-02', value: 2 }] })] },
      isLoading: false,
    });

    render(<KpiStrip {...defaultProps} />);

    expect(screen.getByText('Engagement (7d)')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.getByText('Published (7d)')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('34')).toBeTruthy();
    expect(screen.getByText('Unread replies')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();

    expect(document.querySelectorAll('.animate-pulse').length).toBe(0);
    expect(screen.getAllByTestId('area-chart').length).toBe(1);
  });

  it('falls back to integration count when channel count is missing from summary', () => {
    mockUseDashboardSummary.mockReturnValue({
      data: {
        publishedNext7: 0,
        scheduledPosts: 0,
        commentUnreadCount: 0,
      },
      isLoading: false,
    });
    mockUseOverview.mockReturnValue({
      data: { kpis: [] },
      isLoading: false,
    });

    render(<KpiStrip {...defaultProps} />);

    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders zero-state engagement when overview is unavailable', () => {
    mockUseDashboardSummary.mockReturnValue({
      data: {
        publishedNext7: 0,
        scheduledPosts: 0,
        commentUnreadCount: 0,
        channelsConnected: 0,
      },
      isLoading: false,
    });
    mockUseOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    render(<KpiStrip {...defaultProps} />);

    const tile = screen.getByTestId('kpi-tile-Engagement (7d)');
    expect(tile).toBeTruthy();
    expect(within(tile).getByText('0')).toBeTruthy();
  });

  it('renders tiles as non-interactive when no onClick is provided', () => {
    mockUseDashboardSummary.mockReturnValue({
      data: {
        publishedNext7: 1,
        scheduledPosts: 2,
        commentUnreadCount: 3,
        channelsConnected: 4,
      },
      isLoading: false,
    });
    mockUseOverview.mockReturnValue({
      data: { kpis: [makeKpi()] },
      isLoading: false,
    });

    render(<KpiStrip {...defaultProps} />);

    const tile = screen.getByTestId('kpi-tile-Engagement (7d)');
    expect(tile).toBeTruthy();
    expect(tile.querySelector('[role="button"]')).toBeNull();
    expect(within(tile).getByText('1,234')).toBeTruthy();
  });
});
