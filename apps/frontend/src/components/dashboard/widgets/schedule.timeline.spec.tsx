import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import useSWR from 'swr';
import { ScheduleTimeline } from './schedule.timeline';

const mockPush = vi.fn();

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/kit/states', () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span data-testid="empty-title">{title}</span>
      <span data-testid="empty-description">{description}</span>
    </div>
  ),
  TabSkeleton: ({ variant }: { variant: string }) => (
    <div data-testid="tab-skeleton" data-variant={variant} />
  ),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/kit/channel-avatar', () => ({
  ChannelAvatar: (props: { identifier?: string; name?: string; size?: number }) => (
    <div
      data-testid="channel-avatar"
      data-identifier={props.identifier}
      data-name={props.name}
      data-size={props.size}
    />
  ),
}));

describe('ScheduleTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
  });

  it('renders a skeleton while loading', () => {
    (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    render(<ScheduleTimeline />);

    const skeleton = screen.getByTestId('tab-skeleton');
    expect(skeleton).toBeTruthy();
    expect(skeleton.getAttribute('data-variant')).toBe('list');
  });

  it('renders the empty state when there are no schedule days', () => {
    (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { days: [], gaps: [] },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<ScheduleTimeline />);

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('empty-title').textContent).toBe('No schedule data');
    expect(screen.getByTestId('empty-description').textContent).toBe(
      'Create a post to fill your calendar.'
    );
  });

  it('renders day cards with counts, labels, and upcoming posts', () => {
    (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        days: [
          { date: '2026-07-06', count: 2 },
          { date: '2026-07-07', count: 1 },
        ],
        gaps: [],
      },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(
      <ScheduleTimeline
        upcomingPosts={[
          {
            id: 'post-1',
            content: 'First post',
            publishDate: '2026-07-06T09:00:00Z',
            channelName: 'Channel A',
            providerIdentifier: 'twitter',
          },
          {
            id: 'post-2',
            content: null,
            publishDate: '2026-07-06T14:00:00Z',
            channelName: null,
            providerIdentifier: null,
          },
          {
            id: 'post-3',
            content: 'Solo post',
            publishDate: '2026-07-07T10:00:00Z',
            channelName: 'Channel B',
            providerIdentifier: 'linkedin',
          },
        ]}
      />
    );

    // Day labels and numbers
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Tue')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();

    // Post counts
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();

    // Pluralization
    expect(screen.getByText('posts')).toBeTruthy();
    expect(screen.getByText('post')).toBeTruthy();

    // Post rows (only first two per day)
    expect(screen.getByText('First post')).toBeTruthy();
    expect(screen.getByText('Untitled')).toBeTruthy();
    expect(screen.getByText('Solo post')).toBeTruthy();

    // Avatars receive the right props
    const avatars = screen.getAllByTestId('channel-avatar');
    expect(avatars.length).toBe(3);
    expect(avatars[0].getAttribute('data-identifier')).toBe('twitter');
    expect(avatars[0].getAttribute('data-name')).toBe('Channel A');
    expect(avatars[2].getAttribute('data-identifier')).toBe('linkedin');
  });

  it('highlights gap days and navigates to the composer when Fill is clicked', () => {
    (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        days: [{ date: '2026-07-08', count: 0 }],
        gaps: ['2026-07-08'],
      },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<ScheduleTimeline />);

    const fillButton = screen.getByRole('button', { name: 'Fill' });
    expect(fillButton).toBeTruthy();

    fireEvent.click(fillButton);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/posts/post?date=2026-07-08T10:00:00');
  });
});
