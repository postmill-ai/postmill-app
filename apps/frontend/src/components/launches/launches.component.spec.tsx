import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const mockShow = vi.fn();
const mockReplace = vi.fn();
const mockOpenModal = vi.fn();
let searchParams: Record<string, string> = {};
// Loading by default so the heavy calendar tree stays unmounted; the deep-link
// tests flip it to render the page body.
let integrationsLoading = true;

// The heavy calendar tree never renders in these tests: `useIntegrationList`
// returns `isLoading: true`, so the component short-circuits to the loading
// state. The mount `useEffect` (which owns the `isSameOrigin` logic under test)
// still runs because it is declared above that early return.
vi.mock('@postmill-ai/frontend/components/launches/calendar.context', () => ({
  CalendarWeekProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('@postmill-ai/frontend/components/launches/calendar', () => ({
  useCalendar: () => ({ startDate: '', endDate: '', posts: [] }),
}));
// `LaunchesAgentContext` pulls useCalendar from the aliased path, which resolves
// to this same module — so the mock has to carry it too, or the component throws
// "No useCalendar export is defined" as soon as this file shares a worker with
// something that has already loaded the alias.
vi.mock('./calendar', () => ({
  Calendar: () => null,
  useCalendar: () => ({ startDate: null, endDate: null, posts: [] }),
}));
vi.mock('@postmill-ai/frontend/components/agent/agent-context-bridge', () => ({
  pushAgentUiContext: () => () => {},
}));
vi.mock('@postmill-ai/frontend/components/launches/filters', () => ({
  Filters: () => null,
}));
vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div data-testid="loading" />,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => searchParams[k] ?? null }),
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/posts',
}));
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: mockOpenModal }),
}));
vi.mock('@postmill-ai/frontend/components/launches/post-detail/post.detail.modal', () => ({
  PostDetailModal: ({ postId }: { postId: string }) => (
    <div data-testid="post-detail" data-post-id={postId} />
  ),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));
vi.mock('@postmill-ai/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => vi.fn(),
}));
vi.mock('@postmill-ai/frontend/components/launches/helpers/dnd.provider', () => ({
  DNDProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));
vi.mock('@postmill-ai/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => ({
    isLoading: integrationsLoading,
    data: integrationsLoading ? undefined : [],
    mutate: vi.fn(),
    error: undefined,
  }),
}));
vi.mock('@postmill-ai/frontend/components/launches/add.provider.component', () => ({
  useAddProvider: () => vi.fn(),
}));

import { LaunchesComponent } from './launches.component';

describe('LaunchesComponent — isSameOrigin (3.5)', () => {
  const originalOpener = Object.getOwnPropertyDescriptor(window, 'opener');
  const originalClose = window.close;

  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = {};
    integrationsLoading = true;
    window.close = vi.fn();
  });

  afterEach(() => {
    if (originalOpener) {
      Object.defineProperty(window, 'opener', originalOpener);
    } else {
      // @ts-ignore
      delete (window as any).opener;
    }
    window.close = originalClose;
  });

  it('does not throw when a cross-origin opener.location.origin getter throws', () => {
    const postMessage = vi.fn();
    const throwingOpener = {
      postMessage,
      get location(): Location {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    };
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: throwingOpener,
    });
    searchParams = { msg: 'hello' };

    expect(() => render(<LaunchesComponent />)).not.toThrow();
    // isSameOrigin returned false → no cross-origin postMessage attempted.
    expect(postMessage).not.toHaveBeenCalled();
    // Toast for the `msg` param still fires.
    expect(mockShow).toHaveBeenCalledWith('hello', 'success');
  });

  it('posts a message back to a same-origin opener', () => {
    const postMessage = vi.fn();
    const sameOrigin = {
      postMessage,
      location: { origin: window.location.origin } as Location,
    };
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: sameOrigin,
    });
    searchParams = { added: '1' };

    render(<LaunchesComponent />);
    expect(postMessage).toHaveBeenCalled();
    expect(window.close).toHaveBeenCalled();
  });

  it('does not auto-close when there is no msg/added param', () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: { postMessage, location: { origin: window.location.origin } },
    });
    searchParams = {};

    render(<LaunchesComponent />);
    expect(window.close).not.toHaveBeenCalled();
  });
});

describe('LaunchesComponent — ?post= deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = {};
    integrationsLoading = false;
  });

  it('opens the post detail modal for the linked post', async () => {
    searchParams = { post: 'post-42' };

    render(<LaunchesComponent />);

    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledTimes(1));
    const children = mockOpenModal.mock.calls[0][0].children;
    expect(children.props.postId).toBe('post-42');
    // The param is dropped, so closing the modal doesn't leave a URL that reopens it.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/posts', { scroll: false }));
  });

  it('opens nothing without the param', async () => {
    render(<LaunchesComponent />);

    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());
    expect(mockOpenModal).not.toHaveBeenCalled();
  });
});
