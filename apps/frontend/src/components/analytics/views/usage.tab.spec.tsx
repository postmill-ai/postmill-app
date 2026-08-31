import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('../kit/states', () => ({
  TabSkeleton: () => <div data-testid="tab-skeleton" />,
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-desc">{description}</div>
    </div>
  ),
}));

vi.mock('@postmill-ai/frontend/components/dashboard/hooks/useUsage', () => ({
  useUsage: vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/dashboard/hooks/useAiUsage', () => ({
  useAiUsage: vi.fn(),
}));

import { UsageTab } from './usage.tab';
import { useUsage } from '@postmill-ai/frontend/components/dashboard/hooks/useUsage';
import { useAiUsage } from '@postmill-ai/frontend/components/dashboard/hooks/useAiUsage';

const mockedUseUsage = useUsage as unknown as Mock;
const mockedUseAiUsage = useAiUsage as unknown as Mock;

const planUsage = {
  billingEnabled: true,
  limits: {
    postsPerMonth: 1000,
    channels: 10,
    teamMembers: 5,
    competitors: 3,
    webhooks: 2,
    brandKits: 1,
  },
  usage: {
    postsThisCycle: 120,
    channels: 4,
    teamMembers: 2,
    competitors: 1,
    webhooks: 1,
    brandKits: 1,
  },
};

const aiUsage = {
  byScope: [
    { scope: 'generator', _sum: { costUsd: 4 } },
    { scope: 'agent', _sum: { costUsd: 1 } },
  ],
  byProvider: [
    {
      provider: 'openai',
      monthlySpendUsd: 5,
      dailySpendUsd: 1,
      monthlyCap: 20,
      dailyCap: 2,
      remainingMonthly: 15,
      remainingDaily: 1,
    },
  ],
  totalSpendUsd: 5,
  monthlySpendUsd: 5,
  dailySpendUsd: 1,
  budget: { monthlyCap: 20, dailyCap: 2, remainingMonthly: 15, remainingDaily: 1 },
};

const ok = (data: unknown) => ({ data, isLoading: false, error: undefined });

beforeEach(() => {
  mockedUseUsage.mockReset();
  mockedUseAiUsage.mockReset();
});

describe('UsageTab', () => {
  it('is the one place with both plan usage and AI spend', () => {
    mockedUseUsage.mockReturnValue(ok(planUsage));
    mockedUseAiUsage.mockReturnValue(ok(aiUsage));

    render(<UsageTab />);

    expect(screen.getByText('Plan usage this cycle')).toBeTruthy();
    expect(screen.getByText('120 / 1,000')).toBeTruthy();
    expect(screen.getByText('AI spend')).toBeTruthy();
    expect(screen.getByText('$5.00')).toBeTruthy();
    // Spend by scope exists nowhere else now that the settings copy is gone.
    expect(screen.getByText('Spend by Scope')).toBeTruthy();
    expect(screen.getByText('Generator')).toBeTruthy();
  });

  it('sends you where each number is actually changed', () => {
    mockedUseUsage.mockReturnValue(ok(planUsage));
    mockedUseAiUsage.mockReturnValue(ok(aiUsage));

    render(<UsageTab />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/billing');
    expect(hrefs).toContain('/settings/ai/llm-providers');
  });

  it('shows the AI half alone when billing is off', () => {
    mockedUseUsage.mockReturnValue(ok({ billingEnabled: false }));
    mockedUseAiUsage.mockReturnValue(ok(aiUsage));

    render(<UsageTab />);

    expect(screen.queryByText('Plan usage this cycle')).toBeNull();
    expect(screen.getByText('AI spend')).toBeTruthy();
  });

  it('explains a permission failure rather than claiming there is no data', () => {
    mockedUseUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('403'),
    });
    mockedUseAiUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('403'),
    });

    render(<UsageTab />);

    expect(screen.getByTestId('empty-desc').textContent).toContain('billing access');
  });
});
