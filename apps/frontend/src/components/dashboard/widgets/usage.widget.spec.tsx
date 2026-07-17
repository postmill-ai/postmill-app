import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UsageWidget } from './usage.widget';
import { useUsage } from '../hooks/useUsage';
import { useAiUsage } from '../hooks/useAiUsage';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/kit/states', () => ({
  TabSkeleton: ({ variant }: { variant?: string }) => (
    <div data-testid="tab-skeleton" data-variant={variant} />
  ),
  EmptyState: ({
    title,
    description,
  }: {
    title?: string;
    description?: string;
  }) => (
    <div data-testid="empty-state">
      {title && <div data-testid="empty-title">{title}</div>}
      {description && <div data-testid="empty-desc">{description}</div>}
    </div>
  ),
}));

vi.mock('../hooks/useUsage', () => ({ useUsage: vi.fn() }));
vi.mock('../hooks/useAiUsage', () => ({ useAiUsage: vi.fn() }));

const mockedUseUsage = useUsage as Mock;
const mockedUseAiUsage = useAiUsage as Mock;

describe('UsageWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    });
  });

  it('renders the plan-usage skeleton while usage is loading', () => {
    mockedUseUsage.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
    });

    render(<UsageWidget />);

    expect(screen.getByTestId('tab-skeleton')).toBeTruthy();
    expect(screen.getByTestId('tab-skeleton').getAttribute('data-variant')).toBe('list');
  });

  it('renders the empty state when there is no plan data and no AI data', () => {
    mockedUseAiUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('ai unavailable'),
    });

    render(<UsageWidget />);

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('empty-title').textContent).toBe('Usage data unavailable');
    expect(screen.getByTestId('empty-desc').textContent).toBe(
      'Plan usage and AI budget will appear here.'
    );
  });

  it('renders plan usage bars with correct labels, values and percentages', () => {
    mockedUseUsage.mockReturnValue({
      data: {
        billingEnabled: true,
        limits: {
          postsPerMonth: 100,
          channels: 10,
          teamMembers: 20,
        },
        usage: {
          postsThisCycle: 75,
          channels: 3,
          teamMembers: 5,
        },
      },
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('ai unavailable'),
    });

    render(<UsageWidget />);

    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('Posts')).toBeTruthy();
    expect(screen.getByText('75 / 100')).toBeTruthy();
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('3 / 10')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText('5 / 20')).toBeTruthy();
  });

  it('renders AI spend cards including remaining budget', () => {
    mockedUseUsage.mockReturnValue({
      data: {
        billingEnabled: false,
      },
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: {
        byScope: [],
        totalSpendUsd: 52.5,
        monthlySpendUsd: 12.5,
        dailySpendUsd: 3.25,
        budget: {
          monthlyCap: 50,
          dailyCap: 10,
          remainingMonthly: 37.5,
          remainingDaily: 6.75,
        },
      },
      isLoading: false,
      error: undefined,
    });

    render(<UsageWidget />);

    expect(screen.getByText('AI spend')).toBeTruthy();

    const monthlyCard = screen.getByText('Monthly').parentElement as HTMLElement;
    expect(within(monthlyCard).getByText('$12.50')).toBeTruthy();
    expect(within(monthlyCard).getByText('$37.50 left')).toBeTruthy();

    const dailyCard = screen.getByText('Daily').parentElement as HTMLElement;
    expect(within(dailyCard).getByText('$3.25')).toBeTruthy();
    expect(within(dailyCard).getByText('$6.75 left')).toBeTruthy();
  });

  it('shows both plan and AI sections when both data sources are available', () => {
    mockedUseUsage.mockReturnValue({
      data: {
        billingEnabled: true,
        limits: {
          postsPerMonth: 50,
          channels: 5,
          teamMembers: 10,
        },
        usage: {
          postsThisCycle: 10,
          channels: 2,
          teamMembers: 4,
        },
      },
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: {
        byScope: [],
        totalSpendUsd: 1,
        monthlySpendUsd: 1,
        dailySpendUsd: 1,
        budget: null,
      },
      isLoading: false,
      error: undefined,
    });

    render(<UsageWidget />);

    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('AI spend')).toBeTruthy();
    expect(screen.getByText('10 / 50')).toBeTruthy();
    expect(screen.getAllByText('$1.00')).toHaveLength(2);
  });

  it('caps progress at 100% and applies the over-limit color when usage exceeds the limit', () => {
    mockedUseUsage.mockReturnValue({
      data: {
        billingEnabled: true,
        limits: {
          postsPerMonth: 100,
          channels: 10,
          teamMembers: 20,
        },
        usage: {
          postsThisCycle: 150,
          channels: 3,
          teamMembers: 5,
        },
      },
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('ai unavailable'),
    });

    const { container } = render(<UsageWidget />);

    expect(screen.getByText('150 / 100')).toBeTruthy();

    const overBar = container.querySelector('[style*="width: 100%"]') as HTMLElement;
    expect(overBar).toBeTruthy();
    expect(overBar.className).toContain('bg-[var(--negative,#f97066)]');
  });

  it('omits the progress bar and slash when a limit is disabled (boolean false)', () => {
    mockedUseUsage.mockReturnValue({
      data: {
        billingEnabled: true,
        limits: {
          postsPerMonth: 100,
          channels: false,
          teamMembers: 20,
        },
        usage: {
          postsThisCycle: 10,
          channels: 99,
          teamMembers: 5,
        },
      },
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('ai unavailable'),
    });

    render(<UsageWidget />);

    const channelsLabel = screen.getByText('Channels');
    const channelsHeader = channelsLabel.parentElement as HTMLElement;
    const channelsBar = channelsHeader.parentElement as HTMLElement;
    expect(within(channelsHeader).getByText('99')).toBeTruthy();
    expect(within(channelsHeader).queryByText(/\//)).toBeNull();
    expect(channelsBar.querySelector('[class*="h-[6px]"]')).toBeNull();
  });

  it('shows the AI loading pulse while AI usage is still loading but already has data', () => {
    mockedUseUsage.mockReturnValue({
      data: { billingEnabled: false },
      isLoading: false,
      error: undefined,
    });
    mockedUseAiUsage.mockReturnValue({
      data: {
        byScope: [],
        totalSpendUsd: 0,
        monthlySpendUsd: 0,
        dailySpendUsd: 0,
        budget: null,
      },
      isLoading: true,
      error: undefined,
    });

    const { container } = render(<UsageWidget />);

    expect(screen.getByText('AI spend')).toBeTruthy();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });
});
