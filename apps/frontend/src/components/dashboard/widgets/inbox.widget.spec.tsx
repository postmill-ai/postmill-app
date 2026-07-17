import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import { useInboxPreview } from '../hooks/useInboxPreview';
import { InboxWidget } from './inbox.widget';

dayjs.extend(relativeTime);

const mockPush = vi.hoisted(() => vi.fn());

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''))
        : fallback,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('../hooks/useInboxPreview', () => ({
  useInboxPreview: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/kit/channel-avatar', () => ({
  ChannelAvatar: ({ name, identifier }: { name?: string; identifier?: string }) => (
    <div data-testid="channel-avatar" data-name={name} data-identifier={identifier} />
  ),
}));

vi.mock('@gitroom/frontend/components/analytics-v2/kit/states', () => ({
  TabSkeleton: () => <div data-testid="tab-skeleton">Loading</div>,
  EmptyState: () => <div data-testid="empty-state">Empty</div>,
}));

const mockUseInboxPreview = vi.mocked(useInboxPreview);

const makeComment = (overrides: Partial<Parameters<typeof useInboxPreview>[0]> = {}) => ({
  id: `comment-${overrides.id ?? Math.random().toString(36).slice(2)}`,
  authorName: 'Author',
  authorPicture: null,
  content: 'Hello world',
  platformCreatedAt: new Date().toISOString(),
  post: {
    id: 'post-1',
    content: 'Post content',
    integration: {
      name: 'Test Channel',
      providerIdentifier: 'test-provider',
      picture: null,
    },
  },
  ...overrides,
});

describe('InboxWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders a loading skeleton while inbox preview is loading', () => {
    mockUseInboxPreview.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useInboxPreview>);

    render(<InboxWidget />);

    expect(screen.getByTestId('tab-skeleton')).toBeTruthy();
  });

  it('returns null when there are no unread comments', () => {
    mockUseInboxPreview.mockReturnValue({
      data: { comments: [] },
      isLoading: false,
    } as ReturnType<typeof useInboxPreview>);

    const { container } = render(<InboxWidget />);

    expect(container.firstChild).toBeNull();
  });

  it('renders unread count, author, content, time and channel for each comment', () => {
    const comments = [
      makeComment({
        id: '1',
        authorName: 'Alice',
        content: 'First comment',
        platformCreatedAt: '2026-07-06T11:59:55.000Z',
      }),
      makeComment({
        id: '2',
        authorName: 'Bob',
        content: 'Second comment',
        platformCreatedAt: '2026-07-06T11:59:50.000Z',
        post: {
          id: 'post-2',
          content: null,
          integration: null,
        },
      }),
    ];

    mockUseInboxPreview.mockReturnValue({
      data: { comments },
      isLoading: false,
    } as ReturnType<typeof useInboxPreview>);

    render(<InboxWidget />);

    expect(screen.getByText('2 unread')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('First comment')).toBeTruthy();
    expect(screen.getByText('Second comment')).toBeTruthy();
    expect(screen.getAllByText(/a few seconds ago/)).toHaveLength(2);
    expect(screen.getByText('Test Channel')).toBeTruthy();
    expect(screen.queryByText('No channel')).toBeNull();
  });

  it('truncates long comment content with an ellipsis', () => {
    const longContent = 'a'.repeat(80);
    const comments = [
      makeComment({
        id: '3',
        content: longContent,
      }),
    ];

    mockUseInboxPreview.mockReturnValue({
      data: { comments },
      isLoading: false,
    } as ReturnType<typeof useInboxPreview>);

    render(<InboxWidget />);

    expect(screen.getByText(`${'a'.repeat(60)}…`)).toBeTruthy();
  });

  it('shows "showing 4" helper when there are more than four unread comments', () => {
    const comments = Array.from({ length: 5 }, (_, i) =>
      makeComment({ id: `c-${i}`, authorName: `User ${i}`, content: `Comment ${i}` })
    );

    mockUseInboxPreview.mockReturnValue({
      data: { comments },
      isLoading: false,
    } as ReturnType<typeof useInboxPreview>);

    render(<InboxWidget />);

    expect(screen.getByText('5 unread')).toBeTruthy();
    expect(screen.getByText('showing 4')).toBeTruthy();
  });

  it('navigates to /replies when a comment row is clicked', () => {
    const comments = [
      makeComment({ id: '4', authorName: 'Charlie', content: 'Click me' }),
    ];

    mockUseInboxPreview.mockReturnValue({
      data: { comments },
      isLoading: false,
    } as ReturnType<typeof useInboxPreview>);

    render(<InboxWidget />);

    fireEvent.click(screen.getByText('Charlie').closest('button')!);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/replies');
  });
});
