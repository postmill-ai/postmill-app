import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockFetchFn = vi.fn();

vi.mock('swr', () => ({
  default: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('dayjs', () => {
  const fromNow = vi.fn(() => '2 days ago');
  const dayjsMock = vi.fn(() => ({ fromNow })) as any;
  dayjsMock.extend = vi.fn();
  return { default: dayjsMock };
});

vi.mock('./comment.composer', () => ({
  CommentComposer: ({ onClose, onSubmitted, postId, replyToCommentId, integrationName }: any) => (
    <div data-testid="comment-composer" data-postid={postId} data-replyto={replyToCommentId || ''} data-integration={integrationName}>
      CommentComposer
      <button data-testid="composer-close" onClick={onClose}>Close</button>
      <button data-testid="composer-submitted" onClick={onSubmitted}>Submit</button>
    </div>
  ),
}));

import useSWR from 'swr';
import { CommentThread } from './comment.thread';

const mockUseSWR = vi.mocked(useSWR);

function stubSwr(overrides: Record<string, any>) {
  mockUseSWR.mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
    ...overrides,
  } as any);
}

function buildComment(id: string, overrides?: Record<string, any>): Record<string, any> {
  return {
    id,
    postId: 'p1',
    integrationId: 'i1',
    platformCommentId: `pc-${id}`,
    parentPlatformCommentId: null,
    authorId: `author-${id}`,
    authorName: 'John',
    authorUsername: 'john123',
    authorPicture: '/avatar.jpg',
    content: 'Great post!',
    likeCount: 5,
    replyCount: 2,
    likedByMe: false,
    isOwn: false,
    platformCreatedAt: '2024-01-01T12:00:00Z',
    ...overrides,
  };
}

describe('CommentThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Loading comments..." when loading', () => {
    stubSwr({ isLoading: true });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByTestId('comment-skeleton')).toBeTruthy();
  });

  it('shows "Comments aren\'t available" when notSupported flag is true', () => {
    stubSwr({ data: { comments: [], notSupported: true } });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(
      screen.getByText("Replies aren't available for this channel yet")
    ).toBeTruthy();
  });

  it('shows "Comments aren\'t available" when error is returned', () => {
    stubSwr({ error: new Error('API error') });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(
      screen.getByText("Replies aren't available for this channel yet")
    ).toBeTruthy();
  });

  it('shows "No replies yet" when comments array is empty', () => {
    stubSwr({ data: { comments: [] } });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('No replies yet')).toBeTruthy();
  });

  it('renders top-level comments (parentPlatformCommentId is null)', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { content: 'First comment' }),
          buildComment('c2', { content: 'Second comment' }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('First comment')).toBeTruthy();
    expect(screen.getByText('Second comment')).toBeTruthy();
  });

  it('renders top-level comments (parentPlatformCommentId is undefined)', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { parentPlatformCommentId: undefined, content: 'Top level' }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('Top level')).toBeTruthy();
  });

  it('renders child comments below their parents', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('parent', { platformCommentId: 'pc-parent', content: 'Parent' }),
          buildComment('child', {
            parentPlatformCommentId: 'pc-parent',
            platformCommentId: 'pc-child',
            content: 'Child reply',
          }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('Parent')).toBeTruthy();
    expect(screen.getByText('Child reply')).toBeTruthy();
  });

  it('renders author name and username for top-level comment', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1'),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('John')).toBeTruthy();
    expect(screen.getByText('@john123')).toBeTruthy();
  });

  it('renders author avatar image when authorPicture is present', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { authorPicture: '/pic.jpg' }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    const img = screen.getByAltText('');
    expect(img.getAttribute('src')).toBe('/pic.jpg');
  });

  it('renders fallback avatar when authorPicture is null', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { authorPicture: null }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('J')).toBeTruthy();
  });

  it('like button triggers POST to like endpoint', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { id: 'c1', likeCount: 5, likedByMe: false }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    screen.getByLabelText('Like').click();
    expect(mockFetchFn).toHaveBeenCalledWith(
      '/posts/p1/social-comments/c1/like',
      { method: 'POST', body: JSON.stringify({ like: true }) }
    );
  });

  it('like button sends liked=false when comment is already liked', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { id: 'c1', likedByMe: true }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    screen.getByLabelText('Like').click();
    expect(mockFetchFn).toHaveBeenCalledWith(
      '/posts/p1/social-comments/c1/like',
      { method: 'POST', body: JSON.stringify({ like: false }) }
    );
  });

  it('displays like count when greater than zero', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { likeCount: 5 }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('does not display like count when zero', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { likeCount: 0 }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    const likeButton = screen.getByLabelText('Like');
    expect(likeButton.textContent?.trim()).not.toContain('0');
  });

  it('reply button toggles CommentComposer visibility', async () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1'),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.queryByTestId('comment-composer')).toBeNull();
    await act(async () => {
      screen.getByLabelText('Reply').click();
    });
    expect(screen.getByTestId('comment-composer')).toBeTruthy();
  });

  it('reply button hides CommentComposer on second click', async () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1'),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    const replyBtn = screen.getByLabelText('Reply');
    await act(async () => {
      replyBtn.click();
    });
    expect(screen.getByTestId('comment-composer')).toBeTruthy();
    await act(async () => {
      replyBtn.click();
    });
    expect(screen.queryByTestId('comment-composer')).toBeNull();
  });

  it('passes correct props to CommentComposer when replying', async () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1'),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    await act(async () => {
      screen.getByLabelText('Reply').click();
    });
    const composer = screen.getByTestId('comment-composer');
    expect(composer.getAttribute('data-postid')).toBe('p1');
    expect(composer.getAttribute('data-replyto')).toBe('c1');
    expect(composer.getAttribute('data-integration')).toBe('Twitter');
  });

  it('shows time ago text for comment', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1'),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.getByText('2 days ago')).toBeTruthy();
  });

  it('does not render username when authorUsername is null', () => {
    stubSwr({
      data: {
        comments: [
          buildComment('c1', { authorUsername: null }),
        ],
      },
    });
    render(
      <CommentThread
        postId="p1"
        integrationId="i1"
        releaseId="r1"
        integrationName="Twitter"
      />
    );
    expect(screen.queryByText('@john123')).toBeNull();
  });
});
