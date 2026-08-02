import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttentionFeed } from './attention.feed';
import { AttentionItemDto } from '../hooks/useAttention';

const push = vi.fn();
const mockRetry = vi.fn();
const mockDismiss = vi.fn();
const mockShow = vi.fn();

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
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

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

vi.mock('../hooks/useAttention', () => ({
  useAttention: vi.fn(),
  AttentionItemDto: {} as any,
}));

vi.mock('@postmill-ai/frontend/components/analytics-v2/kit/states', () => ({
  TabSkeleton: ({ variant }: { variant?: string }) => (
    <div data-testid="tab-skeleton" data-variant={variant} />
  ),
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@postmill-ai/react/form/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

import { useAttention } from '../hooks/useAttention';

const mockHook = useAttention as unknown as ReturnType<typeof vi.fn>;

function makeItem(overrides: Partial<AttentionItemDto> = {}): AttentionItemDto {
  return {
    id: 'item-1',
    kind: 'channel-health',
    severity: 'critical',
    title: 'Channels need refresh',
    description: '2 channels need reconnecting',
    count: 2,
    link: '/settings?tab=channels',
    action: { label: 'Fix', type: 'navigate' as const },
    ...overrides,
  };
}

describe('AttentionFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHook.mockReturnValue({ data: undefined, isLoading: true, retryPost: mockRetry, dismissAnomaly: mockDismiss });
  });

  it('renders a skeleton while loading', () => {
    render(<AttentionFeed />);
    expect(screen.getByTestId('tab-skeleton')).toBeTruthy();
  });

  it('renders the all-clear state when there are no items', () => {
    mockHook.mockReturnValue({ data: { items: [] }, isLoading: false, retryPost: mockRetry, dismissAnomaly: mockDismiss });
    render(<AttentionFeed />);

    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.getByText('Nothing needs your attention right now.')).toBeTruthy();
  });

  it('renders items sorted by severity', () => {
    const items = [
      makeItem({ id: 'info-1', kind: 'schedule-gaps', severity: 'info', title: 'Schedule gap' }),
      makeItem({ id: 'crit-1', kind: 'failed-posts', severity: 'critical', title: 'Failed post' }),
      makeItem({ id: 'warn-1', kind: 'pending-approvals', severity: 'warning', title: 'Pending approval' }),
    ];
    mockHook.mockReturnValue({ data: { items }, isLoading: false, retryPost: mockRetry, dismissAnomaly: mockDismiss });

    render(<AttentionFeed />);

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Failed post', 'Pending approval', 'Schedule gap']);
  });

  it('navigates when the action button is clicked', () => {
    mockHook.mockReturnValue({
      data: { items: [makeItem({ link: '/settings?tab=channels', action: { label: 'Fix', type: 'navigate' } })] },
      isLoading: false,
      retryPost: mockRetry,
      dismissAnomaly: mockDismiss,
    });

    render(<AttentionFeed />);
    fireEvent.click(screen.getByText('Fix'));

    // The backend still emits the `?tab=` shim (and /dashboard/attention is
    // Redis-cached, so it will for a while); the UI normalises it so a click
    // costs one navigation instead of two.
    expect(push).toHaveBeenCalledWith('/settings/channels');
  });

  it('sends budget items to usage rather than the pages with no usage on them', () => {
    // `/billing` renders no usage at all and `/settings?tab=ai` has no budget UI,
    // so both backend links are dead ends.
    mockHook.mockReturnValue({
      data: {
        items: [
          makeItem({
            kind: 'budget',
            link: '/billing',
            action: { label: 'View', type: 'navigate' as const },
          }),
        ],
      },
      isLoading: false,
      retryPost: mockRetry,
      dismissAnomaly: mockDismiss,
    });

    render(<AttentionFeed />);
    fireEvent.click(screen.getByText('View'));

    expect(push).toHaveBeenCalledWith('/analytics?tab=usage');
  });

  it('sends failed media jobs to the queue, filtered to failures', () => {
    mockHook.mockReturnValue({
      data: {
        items: [
          makeItem({
            kind: 'failed-media-jobs',
            link: '/media',
            action: { label: 'View', type: 'navigate' as const },
          }),
        ],
      },
      isLoading: false,
      retryPost: mockRetry,
      dismissAnomaly: mockDismiss,
    });

    render(<AttentionFeed />);
    fireEvent.click(screen.getByText('View'));

    expect(push).toHaveBeenCalledWith('/media/queue?status=failed');
  });

  it('keeps a specific backend link instead of falling back to the kind', () => {
    // pending-approvals used to discard item.link, so it could never reach a
    // particular campaign even when the backend named one.
    mockHook.mockReturnValue({
      data: {
        items: [
          makeItem({
            kind: 'pending-approvals',
            link: '/campaigns/abc-123',
            action: { label: 'Review', type: 'navigate' as const },
          }),
        ],
      },
      isLoading: false,
      retryPost: mockRetry,
      dismissAnomaly: mockDismiss,
    });

    render(<AttentionFeed />);
    fireEvent.click(screen.getByText('Review'));

    expect(push).toHaveBeenCalledWith('/campaigns/abc-123');
  });

  it('renders no action button when there is nowhere to go', () => {
    // This used to push '#', which reads as a broken control.
    mockHook.mockReturnValue({
      data: {
        items: [
          makeItem({
            kind: 'something-new' as AttentionItemDto['kind'],
            link: undefined,
            action: { label: 'Open', type: 'navigate' as const },
          }),
        ],
      },
      isLoading: false,
      retryPost: mockRetry,
      dismissAnomaly: mockDismiss,
    });

    render(<AttentionFeed />);

    expect(screen.queryByText('Open')).toBeNull();
  });

  it('expands failed-posts items and calls retryPost', async () => {
    const items = [
      makeItem({
        id: 'failed-1',
        kind: 'failed-posts',
        severity: 'critical',
        title: '2 failed posts',
        count: 2,
        action: {
          label: 'Retry',
          type: 'retry-post' as const,
          payload: {
            posts: [
              { id: 'post-a', channelName: 'X / @acct', error: 'Rate limited' },
              { id: 'post-b', channelName: 'LinkedIn', error: 'Token expired' },
            ],
          },
        },
      }),
    ];
    mockRetry.mockResolvedValue(undefined);
    mockHook.mockReturnValue({ data: { items }, isLoading: false, retryPost: mockRetry, dismissAnomaly: mockDismiss });

    render(<AttentionFeed />);
    fireEvent.click(await screen.findByText(/Show 2 failed post/));

    expect(screen.getByText('X / @acct')).toBeTruthy();
    expect(screen.getByText('LinkedIn')).toBeTruthy();

    const retryButtons = screen.getAllByText('Retry');
    fireEvent.click(retryButtons[0]);

    await waitFor(() => {
      expect(mockRetry).toHaveBeenCalledWith('post-a');
    });
  });

  it('dismisses anomaly items and calls dismissAnomaly', async () => {
    const items = [
      makeItem({ id: 'anomaly-1', kind: 'anomalies', severity: 'info', title: 'Anomaly detected' }),
    ];
    mockDismiss.mockResolvedValue(undefined);
    mockHook.mockReturnValue({ data: { items }, isLoading: false, retryPost: mockRetry, dismissAnomaly: mockDismiss });

    render(<AttentionFeed />);
    fireEvent.click(screen.getByLabelText('Dismiss anomaly'));

    await waitFor(() => {
      expect(mockDismiss).toHaveBeenCalledWith('anomaly-1');
    });
  });

  it('shows a warning toast when retry fails', async () => {
    const items = [
      makeItem({
        id: 'failed-1',
        kind: 'failed-posts',
        severity: 'critical',
        title: 'Failed post',
        action: {
          label: 'Retry',
          type: 'retry-post' as const,
          payload: { posts: [{ id: 'post-x', channelName: 'X' }] },
        },
      }),
    ];
    mockRetry.mockRejectedValue(new Error('Not in ERROR state'));
    mockHook.mockReturnValue({ data: { items }, isLoading: false, retryPost: mockRetry, dismissAnomaly: mockDismiss });

    render(<AttentionFeed />);
    fireEvent.click(await screen.findByText('Show 1 failed post'));
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith('Not in ERROR state', 'warning');
    });
  });
});
