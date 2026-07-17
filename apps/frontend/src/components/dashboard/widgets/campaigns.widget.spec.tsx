import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import { CampaignsWidget } from './campaigns.widget';
import { CampaignSummary } from '../hooks/useDashboardCampaigns';

const push = vi.fn();

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''))
        : fallback,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('../hooks/useDashboardCampaigns', () => ({
  useDashboardCampaigns: vi.fn(),
  CampaignSummary: {} as any,
}));

vi.mock('@gitroom/frontend/components/analytics-v2/kit/states', () => ({
  TabSkeleton: ({ variant }: { variant?: string }) => (
    <div data-testid="tab-skeleton" data-variant={variant} />
  ),
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <p data-testid="empty-title">{title}</p>
      <p data-testid="empty-description">{description}</p>
    </div>
  ),
}));

import { useDashboardCampaigns } from '../hooks/useDashboardCampaigns';

const mockHook = useDashboardCampaigns as unknown as ReturnType<typeof vi.fn>;

function makeCampaign(overrides: Partial<CampaignSummary> = {}): CampaignSummary {
  return {
    id: 'campaign-1',
    name: 'Summer Launch',
    endDate: null,
    postCounts: { queue: 1, published: 2, draft: 3, error: 4 },
    goals: [],
    ...overrides,
  };
}

describe('CampaignsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHook.mockReturnValue({ data: undefined, isLoading: true });
  });

  it('renders the loading skeleton while campaigns are loading', () => {
    render(<CampaignsWidget />);

    expect(screen.getByTestId('tab-skeleton')).toBeTruthy();
    expect(screen.getByTestId('tab-skeleton').getAttribute('data-variant')).toBe('list');
  });

  it('renders the empty state when there are no campaigns', () => {
    mockHook.mockReturnValue({ data: [], isLoading: false });
    render(<CampaignsWidget />);

    expect(screen.queryByTestId('tab-skeleton')).toBeNull();
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('empty-title').textContent).toBe('No active campaigns');
    expect(screen.getByTestId('empty-description').textContent).toBe(
      'Create a campaign to group posts, channels, and goals.'
    );
  });

  it('renders campaign names, post-count bars, and goal bars', () => {
    const campaigns = [
      makeCampaign({
        id: 'campaign-1',
        name: 'Summer Launch',
        postCounts: { queue: 2, published: 4, draft: 1, error: 1 },
        goals: [
          { metric: 'clicks', target: 1000, current: 750, pct: 75 },
          { metric: 'likes', target: 500, current: 500, pct: 100 },
        ],
      }),
      makeCampaign({
        id: 'campaign-2',
        name: 'Winter Promo',
        postCounts: { queue: 0, published: 0, draft: 0, error: 0 },
        goals: [],
      }),
    ];
    mockHook.mockReturnValue({ data: campaigns, isLoading: false });

    render(<CampaignsWidget />);

    expect(screen.getByText('Summer Launch')).toBeTruthy();
    expect(screen.getByText('Winter Promo')).toBeTruthy();
    // Goal summary rendered as current / target.
    expect(screen.getByText('750 / 1,000')).toBeTruthy();
    expect(screen.getByText('500 / 500')).toBeTruthy();
    // Campaign with zero posts should have no visible bar children.
    expect(screen.getByText('Winter Promo').closest('button')).toBeTruthy();
  });

  it('shows "Ends today" for a campaign ending today and days-left otherwise', () => {
    const endToday = new Date();
    endToday.setHours(23, 59, 59, 999);

    const endLater = dayjs().add(5, 'day').startOf('day').toISOString();

    const campaigns = [
      makeCampaign({ id: 'campaign-today', name: 'Ends Today', endDate: endToday.toISOString() }),
      makeCampaign({
        id: 'campaign-later',
        name: 'Ends Later',
        endDate: endLater,
      }),
    ];
    mockHook.mockReturnValue({ data: campaigns, isLoading: false });

    render(<CampaignsWidget />);

    expect(screen.getByText('Ends today')).toBeTruthy();
    expect(screen.getByText(/\d+d left/)).toBeTruthy();
  });

  it('navigates to the campaign detail page when a campaign card is clicked', () => {
    const campaigns = [makeCampaign({ id: 'abc-123', name: 'Clickable Campaign' })];
    mockHook.mockReturnValue({ data: campaigns, isLoading: false });

    render(<CampaignsWidget />);

    const button = screen.getByText('Clickable Campaign').closest('button')!;
    fireEvent.click(button);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/campaigns/abc-123');
  });
});
