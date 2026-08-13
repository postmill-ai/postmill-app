import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
}));

// Every SWR key this component asks for, so the inbox request can be inspected.
// The returned objects MUST be referentially stable: the inbox resets its
// accumulated pages in an effect keyed on `data`, so a fresh object per render
// spins forever.
const swrKeys: string[] = [];
vi.mock('swr', () => {
  const inbox = {
    data: {
      comments: [
        { id: 'c1', content: 'first', authorName: 'Ann' },
        { id: 'c2', content: 'second', authorName: 'Bo' },
      ],
    },
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
  };
  const empty = { data: [], isLoading: false, error: undefined, mutate: vi.fn() };
  return {
    default: (key: string) => {
      swrKeys.push(key);
      return typeof key === 'string' && key.startsWith('/posts/inbox') ? inbox : empty;
    },
  };
});

vi.mock('./comment.card', () => ({
  CommentCard: ({ comment, highlighted }: { comment: { id: string }; highlighted?: boolean }) => (
    <div data-testid={`card-${comment.id}`} data-highlighted={highlighted ? 'yes' : 'no'} />
  ),
}));

vi.mock('@postmill-ai/frontend/components/ui/page-header', () => ({
  PageHeader: () => <div data-testid="page-header" />,
}));

vi.mock('./filters/replies.filter.bar', () => ({
  RepliesFilterBar: () => <div data-testid="filter-bar" />,
}));

vi.mock('@postmill-ai/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => ({ data: [] }),
}));

vi.mock('@postmill-ai/frontend/components/settings/roles/hooks/use-roles', () => ({
  useTeamMembers: () => ({ data: [] }),
}));

import { CommentInbox } from './comment.inbox';

const inboxKey = () => swrKeys.find((k) => typeof k === 'string' && k.startsWith('/posts/inbox'))!;

beforeEach(() => {
  swrKeys.length = 0;
  searchParams = new URLSearchParams();
});
afterEach(cleanup);

describe('CommentInbox deep links', () => {
  it('seeds its filters from the URL', () => {
    searchParams = new URLSearchParams(
      'unreadOnly=true&status=needs_reply&integrationId=i1,i2&priority=high'
    );

    render(<CommentInbox />);

    const key = inboxKey();
    expect(key).toContain('unreadOnly=true');
    expect(key).toContain('status=needs_reply');
    expect(key).toContain('integrationId=i1%2Ci2');
    expect(key).toContain('priority=high');
  });

  it('highlights the linked reply and nothing else', () => {
    searchParams = new URLSearchParams('comment=c2');

    render(<CommentInbox />);

    expect(screen.getByTestId('card-c2').getAttribute('data-highlighted')).toBe('yes');
    expect(screen.getByTestId('card-c1').getAttribute('data-highlighted')).toBe('no');
  });

  it('asks for the unfiltered inbox when the URL carries nothing', () => {
    render(<CommentInbox />);

    expect(inboxKey()).toBe('/posts/inbox?');
    expect(screen.getByTestId('card-c1').getAttribute('data-highlighted')).toBe('no');
  });
});
