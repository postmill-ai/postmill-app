import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

// Response every `fetch()` in the component resolves to; swapped per test.
let mockResponse: any;

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn().mockImplementation(() => Promise.resolve(mockResponse)),
}));

// Minimal useSWR: actually runs the fetcher and, like real SWR, keeps the last good
// data when a revalidation rejects.
vi.mock('swr', () => ({
  // Named `use…` so react-hooks/rules-of-hooks treats the body as a hook; a
  // function expression so the mock factory stays self-contained (vi.mock is
  // hoisted above module scope).
  default: function useMockSwr(key: string, fetcher: any) {
    const [state, setState] = React.useState<{
      data?: any;
      error?: any;
      isLoading: boolean;
    }>({ isLoading: true });
    React.useEffect(() => {
      let cancelled = false;
      Promise.resolve(fetcher(key)).then(
        (data) => !cancelled && setState({ data, isLoading: false }),
        (error) =>
          !cancelled &&
          setState((prev) => ({ data: prev.data, error, isLoading: false }))
      );
      return () => {
        cancelled = true;
      };
    }, [key, fetcher]);
    return { ...state, mutate: vi.fn() };
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock('@uidotdev/usehooks', () => ({
  useClickAway: () => ({ current: null }),
}));

vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  default: () => <div data-testid="loading" />,
}));

vi.mock('@postmill-ai/frontend/components/shared/safe-content', () => ({
  SafeContent: ({ content }: any) => <div>{content}</div>,
}));

import NotificationComponent, {
  NotificationOpenComponent,
} from './notification.component';

const throttled = {
  ok: false,
  status: 429,
  json: () =>
    Promise.resolve({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    }),
};

describe('NotificationComponent unread badge (C4)', () => {
  beforeEach(() => {
    mockResponse = undefined;
  });

  it('renders the unread count on a healthy response', async () => {
    mockResponse = { ok: true, status: 200, json: () => Promise.resolve({ total: 5 }) };

    render(<NotificationComponent />);

    await waitFor(() => {
      expect(screen.getByText('5')).toBeDefined();
    });
  });

  it('does not render a badge from a throttled response body', async () => {
    // `{"statusCode":429}` has no `total`; without the res.ok guard the badge would be
    // driven by whatever that body happens to contain.
    mockResponse = throttled;

    const { container } = render(<NotificationComponent />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeDefined();
    });
    expect(container.querySelector('span.bg-badge')).toBeNull();
  });
});

describe('NotificationOpenComponent list (C4)', () => {
  it('renders the list on a healthy response', async () => {
    mockResponse = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: 'n1',
              type: 'post_published',
              title: 'Published',
              content: 'Your post went out',
              createdAt: new Date().toISOString(),
              readAt: null,
            },
          ],
        }),
    };

    render(<NotificationOpenComponent onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Your post went out')).toBeDefined();
    });
  });

  it('survives a throttled response instead of throwing on the missing array', async () => {
    // Pre-fix the 429 body was parsed as data, so `data.notifications.length` threw and
    // took the whole panel down.
    mockResponse = throttled;

    render(<NotificationOpenComponent onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeDefined();
    });
    // "Mark all read" is only meaningful with real data — it must stay hidden.
    expect(screen.queryByText('Mark all read')).toBeNull();
  });
});
