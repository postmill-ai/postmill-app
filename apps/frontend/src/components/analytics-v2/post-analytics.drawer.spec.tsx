import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PostDetailBody, PostAnalyticsDrawer } from './post-analytics.drawer';
import { PostDetail } from './utils';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

vi.mock('./post.detail.chart', () => ({
  PostDetailChart: () => <div data-testid="post-detail-chart" />,
}));

vi.mock('./kit/channel-avatar', () => ({
  ChannelAvatar: ({ name }: { name: string }) => (
    <div data-testid="channel-avatar">{name}</div>
  ),
}));

const mockUsePostDetail = vi.fn();
vi.mock('./hooks/usePostDetail', () => ({
  usePostDetail: (...a: any[]) => mockUsePostDetail(...a),
}));

const mockUsePostShortlinkStats = vi.fn();
vi.mock('./hooks/usePostShortlinkStats', () => ({
  usePostShortlinkStats: (...a: any[]) => mockUsePostShortlinkStats(...a),
}));

const postDetail: PostDetail = {
  postId: 'p1',
  content: 'Hello world post',
  integration: { id: 'i1', name: 'Twitter', identifier: '@tw', picture: '/p.png' },
  publishedAt: '2026-01-01T00:00:00.000Z',
  metrics: { likes: 10, comments: 5 },
  series: { likes: [{ date: '2026-01-01', value: 10 }] },
};

describe('PostDetailBody', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the loading header and skeleton', () => {
    const { container } = render(
      <PostDetailBody isLoading postDetail={undefined} onClose={vi.fn()} />
    );
    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the error state with the error message', () => {
    render(
      <PostDetailBody
        isLoading={false}
        error={new Error('nope')}
        postDetail={undefined}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Failed to load post details')).toBeTruthy();
    expect(screen.getByText('nope')).toBeTruthy();
  });

  it('renders the post detail (header, content, metrics, chart)', () => {
    render(
      <PostDetailBody isLoading={false} postDetail={postDetail} onClose={vi.fn()} />
    );
    // Header shows the post content (not the "Post Detail" fallback).
    expect(screen.getAllByText('Hello world post').length).toBeGreaterThan(0);
    expect(screen.getByTestId('channel-avatar')).toBeTruthy();
    expect(screen.getByText('likes')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('comments')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByTestId('post-detail-chart')).toBeTruthy();
  });

  it('falls back to "Post Detail" header when content is empty', () => {
    render(
      <PostDetailBody
        isLoading={false}
        postDetail={{ ...postDetail, content: '' }}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Post Detail')).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PostDetailBody isLoading={false} postDetail={postDetail} onClose={onClose} />
    );
    fireEvent.click(container.querySelector('button') as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PostAnalyticsDrawer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    mockUsePostDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    });
    mockUsePostShortlinkStats.mockReturnValue({ data: undefined });
  });

  it('renders nothing when closed and passes empty ids to the hooks', () => {
    const { container } = render(
      <PostAnalyticsDrawer postId="p1" open={false} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockUsePostDetail).toHaveBeenCalledWith('');
    expect(mockUsePostShortlinkStats).toHaveBeenCalledWith('');
  });

  it('passes the postId to the hooks when open', () => {
    mockUsePostDetail.mockReturnValue({
      data: postDetail,
      isLoading: false,
      error: undefined,
    });
    render(<PostAnalyticsDrawer postId="p1" open onClose={vi.fn()} />);
    expect(mockUsePostDetail).toHaveBeenCalledWith('p1');
    expect(mockUsePostShortlinkStats).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('Hello world post').length).toBeGreaterThan(0);
  });

  it('renders the short-link statistics table when clicks are present', () => {
    mockUsePostDetail.mockReturnValue({
      data: postDetail,
      isLoading: false,
      error: undefined,
    });
    mockUsePostShortlinkStats.mockReturnValue({
      data: {
        clicks: [
          { short: 'https://s.ly/a', original: 'https://example.com/a', clicks: 42 },
        ],
      },
    });
    render(<PostAnalyticsDrawer postId="p1" open onClose={vi.fn()} />);
    expect(screen.getByText('Short Links Statistics')).toBeTruthy();
    expect(screen.getByText('https://s.ly/a')).toBeTruthy();
    expect(screen.getByText('https://example.com/a')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('omits the short-link table when there are no clicks', () => {
    mockUsePostDetail.mockReturnValue({
      data: postDetail,
      isLoading: false,
      error: undefined,
    });
    mockUsePostShortlinkStats.mockReturnValue({ data: { clicks: [] } });
    render(<PostAnalyticsDrawer postId="p1" open onClose={vi.fn()} />);
    expect(screen.queryByText('Short Links Statistics')).toBeNull();
  });
});
