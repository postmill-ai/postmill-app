import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentCard, InboxComment } from './comment.card';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback: string) => fallback,
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
}));

vi.mock('@gitroom/frontend/components/shared/provider-icon', () => ({
  default: ({ name }: { name: string }) => <span data-testid="provider-icon">{name}</span>,
}));

vi.mock('@gitroom/frontend/components/launches/post-detail/comment.composer', () => ({
  CommentComposer: () => <div data-testid="comment-composer" />,
}));

describe('CommentCard', () => {
  const baseComment: InboxComment = {
    id: 'c1',
    content: 'Great post!',
    authorName: 'Alice',
    authorUsername: 'alice',
    authorPicture: null,
    platformCreatedAt: new Date().toISOString(),
    status: 'needs_reply',
    isOwn: false,
    likeCount: 0,
    likedByMe: false,
    assigneeId: null,
    post: {
      id: 'p1',
      content: 'Original post',
      integration: {
        name: 'Mastodon',
        providerIdentifier: 'mastodon',
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sentiment and priority badges when present', () => {
    const comment: InboxComment = {
      ...baseComment,
      sentiment: 'positive',
      priority: 'low',
      sentimentConfidence: 0.92,
    };

    render(<CommentCard comment={comment} onChanged={vi.fn()} />);

    expect(screen.getByText(/positive/i)).toBeTruthy();
    expect(screen.getByText(/low/i)).toBeTruthy();
  });

  it('does not render badges when sentiment/priority are null', () => {
    render(<CommentCard comment={baseComment} onChanged={vi.fn()} />);

    expect(screen.queryByText(/positive/i)).toBeNull();
    expect(screen.queryByText(/negative/i)).toBeNull();
    expect(screen.queryByText(/high/i)).toBeNull();
    expect(screen.queryByText(/low/i)).toBeNull();
  });

  it('renders negative/high priority with distinct colors', () => {
    const comment: InboxComment = {
      ...baseComment,
      sentiment: 'negative',
      priority: 'high',
      sentimentConfidence: 0.88,
    };

    const { container } = render(<CommentCard comment={comment} onChanged={vi.fn()} />);

    const negativeBadge = container.querySelector('.text-dangerText');
    expect(negativeBadge).toBeTruthy();
    expect(screen.getByText(/negative/i)).toBeTruthy();
    expect(screen.getByText(/high/i)).toBeTruthy();
  });
});
