import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const mockUseBestTime = vi.fn();
vi.mock('../hooks/useBestTime', () => ({
  useBestTime: (integrations?: string[], integration?: string) =>
    mockUseBestTime(integrations, integration),
}));

const mockUseIntegrationList = vi.fn(() => ({ data: [] as any[] }));
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => mockUseIntegrationList(),
}));

import { BestTimeTab } from './best-time.tab';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}`);

describe('BestTimeTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the loading state', () => {
    mockUseBestTime.mockReturnValue({ data: undefined, isLoading: true, DAY_LABELS, HOUR_LABELS });
    const { container } = render(<BestTimeTab />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the empty state when there is no heatmap', () => {
    mockUseBestTime.mockReturnValue({ data: { heatmap: [] }, isLoading: false, DAY_LABELS, HOUR_LABELS });
    render(<BestTimeTab />);
    expect(screen.getByText(/No data available yet/i)).toBeTruthy();
  });

  it('renders the heatmap grid across the full engagement colour range', () => {
    // Varied avgEngagement / maxAvg ratios exercise every getColorClass branch.
    const heatmap = [0, 0.05, 0.2, 0.4, 0.6, 0.9].map((ratio, i) => ({
      day: i % 7,
      hour: i,
      engagement: ratio * 100,
      postCount: 3,
      avgEngagement: ratio * 100,
    }));
    mockUseBestTime.mockReturnValue({ data: { heatmap }, isLoading: false, DAY_LABELS, HOUR_LABELS });
    render(<BestTimeTab integrations={['i1']} />);

    expect(mockUseBestTime).toHaveBeenCalledWith(['i1'], undefined);
    expect(screen.getByText(/Best Time to Post/i)).toBeTruthy();
  });

  it('shows a "based on N posts" caption and mutes low-confidence cells (6.4)', () => {
    const heatmap = [
      { day: 0, hour: 0, engagement: 100, postCount: 10, avgEngagement: 100, confidence: 'high' as const },
      { day: 0, hour: 1, engagement: 5, postCount: 1, avgEngagement: 5, confidence: 'low' as const },
    ];
    mockUseBestTime.mockReturnValue({ data: { heatmap }, isLoading: false, DAY_LABELS, HOUR_LABELS });
    const { container } = render(<BestTimeTab integrations={['i1']} />);
    expect(screen.getByText(/Based on 11 posts/i)).toBeTruthy();
    expect(container.querySelector('.opacity-40')).toBeTruthy();
  });

  it('renders a channel select when more than one channel is available (6.4)', () => {
    mockUseIntegrationList.mockReturnValueOnce({
      data: [
        { id: 'i1', name: 'Twitter', identifier: 'x', picture: '' },
        { id: 'i2', name: 'Insta', identifier: 'instagram', picture: '' },
      ],
    } as any);
    mockUseBestTime.mockReturnValue({
      data: { heatmap: [{ day: 0, hour: 0, engagement: 1, postCount: 3, avgEngagement: 1 }] },
      isLoading: false,
      DAY_LABELS,
      HOUR_LABELS,
    });
    render(<BestTimeTab integrations={['i1', 'i2']} />);
    expect(screen.getByLabelText('Channel')).toBeTruthy();
  });
});
