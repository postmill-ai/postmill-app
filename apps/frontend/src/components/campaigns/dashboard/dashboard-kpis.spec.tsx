import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

// StatTile's rich variant renders an AreaChart (chart.js) + useCountUp.
vi.mock('chart.js/auto', () => ({
  default: class {
    destroy() {}
  },
}));
vi.mock('@gitroom/frontend/components/analytics-v2/hooks/useCountUp', () => ({
  useCountUp: (target: number) => target,
}));

const mockUseCampaignAnalytics = vi.fn();
vi.mock('@gitroom/frontend/components/campaigns/hooks/campaign.hooks', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useCampaignAnalytics: (...args: unknown[]) => mockUseCampaignAnalytics(...args),
  };
});

import { DashboardKpis } from './dashboard-kpis';

const baseDashboard = {
  engagement: { totalViews: 5000, totalLikes: 200, totalComments: 30, clickTotal: 12 },
  stateCounts: { DRAFT: 1, QUEUE: 2, PUBLISHED: 3 },
  clickTotal: 12,
  goals: [{ metric: 'impressions', target: 10000, current: 5000, pct: 50 }],
  campaign: { id: 'c1', startDate: '2024-01-01', endDate: '2024-02-01' },
};

describe('DashboardKpis', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders rich tiles with a sparkline when the campaign has analytics series', () => {
    mockUseCampaignAnalytics.mockReturnValue({
      data: {
        kpis: [
          { metric: 'views', label: 'Views', format: 'number', total: 3000, previousTotal: 2000, percentageChange: 50, sparkline: [] },
        ],
        series: {
          views: [
            { date: '2024-01-01', value: 100 },
            { date: '2024-01-02', value: 200 },
            { date: '2024-01-03', value: 300 },
          ],
        },
        byChannel: [],
        window: { from: '2024-01-01', to: '2024-01-03' },
      },
    });

    const { container } = render(<DashboardKpis dashboard={baseDashboard} />);
    // Lifetime headline number stays the engagement total, not the windowed sum.
    expect(screen.getByText('5,000')).toBeTruthy();
    // The rich variant renders a sparkline canvas.
    expect(container.querySelector('canvas')).toBeTruthy();
    // Per-goal "as of" freshness hint (3.5).
    expect(screen.getByText(/as of/i)).toBeTruthy();
  });

  it('degrades to plain tiles (no crash, no sparkline) when there is no analytics data', () => {
    mockUseCampaignAnalytics.mockReturnValue({ data: undefined });
    const { container } = render(<DashboardKpis dashboard={baseDashboard} />);
    expect(screen.getByText('5,000')).toBeTruthy();
    expect(screen.getByText('Views')).toBeTruthy();
    expect(container.querySelector('canvas')).toBeNull();
  });
});
