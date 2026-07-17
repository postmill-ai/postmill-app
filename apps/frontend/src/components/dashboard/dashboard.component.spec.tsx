import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''))
        : fallback,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({
    profile: { name: 'Rick', timezone: 'UTC' },
    streakSince: null,
  }),
}));

const mockPermissions = {
  isResolved: true,
  hasPermission: vi.fn(() => true),
};

vi.mock('@gitroom/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => mockPermissions,
}));

vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => ({ data: [] }),
}));

vi.mock('./hooks/useDashboardSummary', () => ({
  useDashboardSummary: () => ({
    data: {
      totalPosts: 12,
      scheduledPosts: 3,
      publishedNext7: 5,
      channelsConnected: 2,
      commentUnreadCount: 0,
      upcomingPosts: [],
    },
    isLoading: false,
  }),
}));

vi.mock('./hooks/useSchedule', () => ({
  useSchedule: () => ({
    data: { days: [], gaps: [] },
    isLoading: false,
  }),
}));

vi.mock('./hooks/useDashboardCampaigns', () => ({
  useDashboardCampaigns: () => ({ data: [], isLoading: false }),
}));

vi.mock('./hooks/useInboxPreview', () => ({
  useInboxPreview: () => ({ data: { comments: [] }, isLoading: false }),
}));

vi.mock('./hooks/useMediaJobs', () => ({
  useMediaJobs: () => ({ data: { jobs: [], counts: { pending: 0, processing: 0, failed7d: 0 } }, isLoading: false }),
}));

vi.mock('./hooks/useUsage', () => ({
  useUsage: () => ({ data: { billingEnabled: false }, isLoading: false }),
}));

vi.mock('./hooks/useAiUsage', () => ({
  useAiUsage: () => ({ data: undefined, error: new Error('ignored'), isLoading: false }),
}));

vi.mock('./hooks/useAttention', () => ({
  useAttention: () => ({ data: { items: [] }, isLoading: false, retryPost: vi.fn(), dismissAnomaly: vi.fn() }),
}));

vi.mock('./hooks/useDailyBrief', () => ({
  useDailyBrief: () => ({ data: { cached: false }, isLoading: false, generate: vi.fn() }),
}));

vi.mock('@gitroom/frontend/components/layout/use-ai-active', () => ({
  useAiActive: () => false,
}));

vi.mock('@gitroom/frontend/components/analytics-v2/hooks/useOverview', () => ({
  useOverview: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/hooks/useRecommendations', () => ({
  useRecommendations: () => ({ data: { recommendations: [] }, isLoading: false }),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/charts/line.chart', () => ({
  LineChart: () => <div data-testid="line-chart">LineChart</div>,
}));

import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent shell', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPermissions.isResolved = true;
    mockPermissions.hasPermission.mockReturnValue(true);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the header, setup, attention, kpi, trend, schedule, campaigns, inbox, media, usage, and recommendations sections', () => {
    render(<DashboardComponent />);

    expect(screen.getByText(/Rick/)).toBeTruthy();
    expect(screen.getByLabelText('Customize dashboard')).toBeTruthy();
    expect(screen.getByText('Welcome to Postmill')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('At a glance')).toBeTruthy();
    expect(screen.getByText('7-day engagement')).toBeTruthy();
    expect(screen.getByText('Next 7 days')).toBeTruthy();
    expect(screen.getByText('Active campaigns')).toBeTruthy();
    expect(screen.getByText('Inbox')).toBeTruthy();
    expect(screen.getByText('Media queue')).toBeTruthy();
    expect(screen.getByText('Usage & budget')).toBeTruthy();
    expect(screen.getByText('Recommendations')).toBeTruthy();
  });

  it('hides a section when its id is in dashboard_prefs', () => {
    localStorage.setItem('dashboard_prefs', JSON.stringify({ hidden: ['kpi'], v: 1 }));
    render(<DashboardComponent />);

    expect(screen.queryByText('At a glance')).toBeNull();
    expect(screen.getByText('7-day engagement')).toBeTruthy();
  });

  it('hides billing/media sections for a viewer-role member', () => {
    mockPermissions.hasPermission.mockImplementation(
      (resource: string) => resource === 'analytics' || resource === 'posts'
    );

    render(<DashboardComponent />);

    expect(screen.getByText('At a glance')).toBeTruthy();
    expect(screen.getByText('Next 7 days')).toBeTruthy();
    expect(screen.queryByText('Usage & budget')).toBeNull();
    expect(screen.queryByText('Media queue')).toBeNull();
  });
});
