import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PostsTab } from './posts.tab';
import { Post, PostDetail } from '../utils';

const mockUsePostDetail = vi.fn().mockReturnValue({
  data: undefined,
  isLoading: false,
  error: undefined,
});

vi.mock('../hooks/usePostDetail', () => ({
  usePostDetail: (...args: any[]) => mockUsePostDetail(...args),
}));

const samplePosts: Post[] = [
  {
    postId: 'p1',
    content: 'Hello world announcement post',
    integration: {
      id: 'i1',
      name: 'Twitter',
      identifier: '@twitter',
      picture: '/tw.png',
    },
    publishedAt: '2024-06-15T10:00:00Z',
    metrics: { impressions: 1000, engagement: 100, likes: 50, comments: 10, shares: 5 },
  },
  {
    postId: 'p2',
    content: 'Second post about product launch',
    integration: {
      id: 'i2',
      name: 'LinkedIn',
      identifier: 'linkedin',
      picture: '/li.png',
    },
    publishedAt: '2024-06-14T08:00:00Z',
    metrics: { impressions: 2000, engagement: 200, likes: 80, comments: 20, shares: 15 },
  },
];

const baseProps = {
  total: 2,
  loading: false,
  page: 1,
  limit: 25,
  sort: 'publishedAt',
  dir: 'desc' as const,
  onPageChange: vi.fn(),
  onSortChange: vi.fn(),
};

describe('PostsTab', () => {
  beforeEach(() => {
    mockUsePostDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
    });
  });

  it('renders loading skeletons', () => {
    const { container } = render(<PostsTab {...baseProps} loading={true} />);
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    render(
      <PostsTab {...baseProps} loading={false} error={new Error('fail')} />
    );
    expect(screen.getByText('Failed to load data')).toBeTruthy();
    expect(screen.getByText('fail')).toBeTruthy();
  });

  it('renders empty state', () => {
    render(<PostsTab {...baseProps} loading={false} posts={[]} total={0} />);
    expect(screen.getByText('No posts found in this period')).toBeTruthy();
  });

  it('renders post table with content and metrics', () => {
    render(
      <PostsTab {...baseProps} posts={samplePosts} total={2} />
    );
    expect(screen.getByText('Hello world announcement post')).toBeTruthy();
    expect(screen.getByText('Second post about product launch')).toBeTruthy();
    expect(screen.getByText('1,000')).toBeTruthy();
    expect(screen.getByText('2,000')).toBeTruthy();
  });

  it('renders metric headers in table', () => {
    render(
      <PostsTab {...baseProps} posts={samplePosts} total={2} />
    );
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('Engagement')).toBeTruthy();
    expect(screen.getByText('Likes')).toBeTruthy();
    expect(screen.getByText('Comments')).toBeTruthy();
    expect(screen.getByText('Shares')).toBeTruthy();
  });

  it('shows pagination when total exceeds limit', () => {
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={50}
        limit={25}
        page={1}
      />
    );
    expect(screen.getByText('1–25 of 50')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Previous')).toBeTruthy();
  });

  it('hides pagination when totalPages <= 1', () => {
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={10}
        limit={25}
        page={1}
      />
    );
    expect(screen.queryByText('Previous')).toBeNull();
    expect(screen.queryByText('Next')).toBeNull();
  });

  it('disables Previous on page 1', () => {
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={50}
        page={1}
        limit={25}
      />
    );
    const prev = screen.getByText('Previous');
    expect((prev as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Next on last page', () => {
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={50}
        page={2}
        limit={25}
      />
    );
    const next = screen.getByText('Next');
    expect((next as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onPageChange when Next is clicked', () => {
    const onPageChange = vi.fn();
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={50}
        page={1}
        limit={25}
        onPageChange={onPageChange}
      />
    );
    screen.getByText('Next').click();
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onSortChange when a sort header is clicked', () => {
    const onSortChange = vi.fn();
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={2}
        onSortChange={onSortChange}
      />
    );
    screen.getByText('Engagement').click();
    expect(onSortChange).toHaveBeenCalledWith('engagement', 'desc');
  });

  it('calls onSortChange with reversed direction when same header is clicked', () => {
    const onSortChange = vi.fn();
    render(
      <PostsTab
        {...baseProps}
        posts={samplePosts}
        total={2}
        sort="engagement"
        dir="desc"
        onSortChange={onSortChange}
      />
    );
    screen.getByText('Engagement').click();
    expect(onSortChange).toHaveBeenCalledWith('engagement', 'asc');
  });

  it('opens post detail panel on row click', () => {
    render(
      <PostsTab {...baseProps} posts={samplePosts} total={2} />
    );
    const rows = document.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    expect(screen.getByText('Post Detail')).toBeTruthy();
  });

  it('shows loading in post detail panel', () => {
    mockUsePostDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
    });

    render(
      <PostsTab {...baseProps} posts={samplePosts} total={2} />
    );
    const rows = document.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('shows post detail panel with data', () => {
    const postDetail: PostDetail = {
      postId: 'p1',
      content: 'Hello world announcement post',
      integration: {
        id: 'i1',
        name: 'Twitter',
        identifier: '@twitter',
        picture: '/tw.png',
      },
      publishedAt: '2024-06-15T10:00:00Z',
      metrics: { impressions: 1000, likes: 50 },
      series: {},
    };

    mockUsePostDetail.mockReturnValue({
      data: postDetail,
      isLoading: false,
      error: undefined,
    });

    render(
      <PostsTab {...baseProps} posts={samplePosts} total={2} />
    );
    const rows = document.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    expect(screen.getByText('impressions')).toBeTruthy();
    expect(screen.getByText('likes')).toBeTruthy();
  });

  it('shows error in post detail panel', () => {
    mockUsePostDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Post not found'),
    });

    render(
      <PostsTab {...baseProps} posts={samplePosts} total={2} />
    );
    const rows = document.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    expect(screen.getByText('Failed to load post details')).toBeTruthy();
    expect(screen.getByText('Post not found')).toBeTruthy();
  });
});
