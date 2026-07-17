import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const mockShow = vi.fn();
let searchParams: Record<string, string> = {};

// The heavy calendar tree never renders in these tests: `useIntegrationList`
// returns `isLoading: true`, so the component short-circuits to the loading
// state. The mount `useEffect` (which owns the `isSameOrigin` logic under test)
// still runs because it is declared above that early return.
vi.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarWeekProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/frontend/components/launches/calendar', () => ({
  useCalendar: () => ({ startDate: '', endDate: '', posts: [] }),
}));
vi.mock('./calendar', () => ({
  Calendar: () => null,
}));
vi.mock('@gitroom/frontend/components/agent/agent-context-bridge', () => ({
  pushAgentUiContext: () => () => {},
}));
vi.mock('@gitroom/frontend/components/launches/filters', () => ({
  Filters: () => null,
}));
vi.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div data-testid="loading" />,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => searchParams[k] ?? null }),
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));
vi.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => vi.fn(),
}));
vi.mock('@gitroom/frontend/components/launches/helpers/dnd.provider', () => ({
  DNDProvider: ({ children }: any) => <>{children}</>,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => ({
    isLoading: true,
    data: undefined,
    mutate: vi.fn(),
    error: undefined,
  }),
}));
vi.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  useAddProvider: () => vi.fn(),
}));

import { LaunchesComponent } from './launches.component';

describe('LaunchesComponent — isSameOrigin (3.5)', () => {
  const originalOpener = Object.getOwnPropertyDescriptor(window, 'opener');
  const originalClose = window.close;

  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = {};
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
