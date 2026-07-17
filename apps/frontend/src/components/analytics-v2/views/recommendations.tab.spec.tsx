import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

const mockUseRecommendations = vi.fn();
vi.mock('../hooks/useRecommendations', () => ({
  useRecommendations: () => mockUseRecommendations(),
}));

import { RecommendationsTab } from './recommendations.tab';

describe('RecommendationsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the loading state', () => {
    mockUseRecommendations.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    // Now uses the shared kit TabSkeleton (F5) — assert the pulsing placeholder,
    // matching the sibling tab specs (best-time, channels, content-insights).
    const { container } = render(<RecommendationsTab />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the error state', () => {
    mockUseRecommendations.mockReturnValue({ data: undefined, isLoading: false, error: new Error('x') });
    render(<RecommendationsTab />);
    expect(screen.getByText(/Failed to load recommendations/i)).toBeTruthy();
  });

  it('renders the empty state', () => {
    mockUseRecommendations.mockReturnValue({ data: { recommendations: [] }, isLoading: false, error: undefined });
    render(<RecommendationsTab />);
    expect(screen.getByText(/No recommendations yet/i)).toBeTruthy();
  });

  it('renders items with priority labels and navigates on action click', () => {
    mockUseRecommendations.mockReturnValue({
      data: {
        recommendations: [
          { type: 'best_time', title: 'Post earlier', description: 'd1', action: 'View', link: '/x', priority: 1 },
          { type: 'coverage_gap', title: 'Add a channel', description: 'd2', action: 'Go', link: '/y', priority: 9 },
        ],
      },
      isLoading: false,
      error: undefined,
    });
    render(<RecommendationsTab />);
    expect(screen.getByText('Post earlier')).toBeTruthy();
    expect(screen.getByText('best time')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Info')).toBeTruthy(); // priority 9 → fallback label

    fireEvent.click(screen.getByText('View'));
    expect(mockPush).toHaveBeenCalledWith('/x');
  });
});
