import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecommendationsStrip } from './recommendations.strip';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const mockUseRecommendations = vi.fn();

vi.mock('@gitroom/frontend/components/analytics-v2/hooks/useRecommendations', () => ({
  useRecommendations: () => mockUseRecommendations(),
}));

describe('RecommendationsStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const recommendations = [
    {
      type: 'best_time',
      title: 'Post on Tuesday mornings',
      description: 'Your audience is most active between 9am and 11am on Tuesdays.',
      action: 'Schedule now',
      link: '/posts?date=2024-01-01',
      priority: 1,
    },
    {
      type: 'channel_gap',
      title: 'Connect LinkedIn',
      description: 'You have no LinkedIn channel connected yet.',
      action: 'Add channel',
      link: '/settings?tab=channels',
      priority: 2,
    },
    {
      type: 'engagement_drop',
      title: 'Engagement is down',
      description: 'Your engagement dropped 12% this week.',
      action: 'View analytics',
      link: '/analytics',
      priority: 3,
    },
  ];

  it('renders the list skeleton while loading', () => {
    mockUseRecommendations.mockReturnValue({ data: undefined, isLoading: true });

    const { container } = render(<RecommendationsStrip />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders recommendation cards with priority badges and content', () => {
    mockUseRecommendations.mockReturnValue({
      data: { recommendations },
      isLoading: false,
    });

    render(<RecommendationsStrip />);

    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();

    expect(screen.getByText('Post on Tuesday mornings')).toBeTruthy();
    expect(screen.getByText('Connect LinkedIn')).toBeTruthy();
    expect(screen.getByText('Engagement is down')).toBeTruthy();

    expect(screen.getByText('Your audience is most active between 9am and 11am on Tuesdays.')).toBeTruthy();

    expect(screen.getByText('Schedule now')).toBeTruthy();
    expect(screen.getByText('Add channel')).toBeTruthy();
    expect(screen.getByText('View analytics')).toBeTruthy();

    expect(screen.getByText('best time')).toBeTruthy();
    expect(screen.getByText('channel gap')).toBeTruthy();
  });

  it('returns null when there are no recommendations', () => {
    mockUseRecommendations.mockReturnValue({
      data: { recommendations: [] },
      isLoading: false,
    });

    const { container } = render(<RecommendationsStrip />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null when data is undefined', () => {
    mockUseRecommendations.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    const { container } = render(<RecommendationsStrip />);

    expect(container.firstChild).toBeNull();
  });

  it('navigates to the recommendation link when the action button is clicked', () => {
    mockUseRecommendations.mockReturnValue({
      data: { recommendations },
      isLoading: false,
    });

    render(<RecommendationsStrip />);

    fireEvent.click(screen.getByText('Schedule now'));
    expect(mockPush).toHaveBeenCalledWith('/posts?date=2024-01-01');

    fireEvent.click(screen.getByText('Add channel'));
    expect(mockPush).toHaveBeenCalledWith('/settings?tab=channels');
  });

  it('limits the rendered cards to the first four recommendations', () => {
    mockUseRecommendations.mockReturnValue({
      data: { recommendations: [...recommendations, ...recommendations] },
      isLoading: false,
    });

    render(<RecommendationsStrip />);

    expect(screen.getAllByText(/Post on Tuesday mornings|Connect LinkedIn|Engagement is down/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole('button').length).toBe(4);
  });
});
