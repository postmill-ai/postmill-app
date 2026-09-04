import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const mockFetch = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockCaptureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: any[]) => mockCaptureException(...args),
}));

// dayjs.tz needs the timezone plugin, which the app registers elsewhere.
vi.mock('dayjs', () => {
  const d: any = () => ({});
  d.tz = () => ({ utcOffset: () => 0 });
  return { default: d };
});

vi.mock('@postmill-ai/frontend/components/layout/set.timezone', () => ({
  newDayjs: () => ({}),
}));

vi.mock('@postmill-ai/frontend/components/layout/redirect', () => ({
  Redirect: () => null,
}));

vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({}),
}));

// The real context module pulls in the whole calendar context tree.
vi.mock('@postmill-ai/frontend/components/launches/helpers/use.integration', () => ({
  IntegrationContext: React.createContext({}),
}));

// A minimal two-step provider: a button that saves a fixed selection. Defined
// inside the factory — vi.mock factories are hoisted above module-level consts.
vi.mock(
  '@postmill-ai/frontend/components/composer/providers/continue-provider/list',
  () => ({
    continueProviderList: {
      facebook: (props: { onSave: (data: any) => Promise<void> }) => (
        <button type="button" onClick={() => props.onSave({ page: 'page-1' })}>
          Save
        </button>
      ),
    },
  })
);

import { ContinueIntegration } from './continue.integration';

const okResponse = (json: any) => ({ status: 200, json: async () => json });

describe('ContinueIntegration popup completion', () => {
  const postMessage = vi.fn();
  let closeSpy: ReturnType<typeof vi.spyOn>;
  let closedDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
    closedDescriptor = Object.getOwnPropertyDescriptor(window, 'closed');
    Object.defineProperty(window, 'closed', {
      configurable: true,
      get: () => true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      writable: true,
      value: null,
    });
    if (closedDescriptor) {
      Object.defineProperty(window, 'closed', closedDescriptor);
    }
    closeSpy.mockRestore();
  });

  it('posts postmill:channel-connected to the opener and closes the popup on success', async () => {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      writable: true,
      value: { postMessage },
    });
    mockFetch.mockResolvedValue(
      okResponse({ id: 'int-1', inBetweenSteps: false })
    );

    render(
      <ContinueIntegration
        provider="x"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'postmill:channel-connected',
          provider: 'x',
          integrationId: 'int-1',
        },
        window.location.origin
      )
    );
    expect(closeSpy).toHaveBeenCalled();
    // Popup reported to the opener — no in-popup navigation.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates normally when there is no opener', async () => {
    mockFetch.mockResolvedValue(
      okResponse({ id: 'int-1', inBetweenSteps: false })
    );

    render(
      <ContinueIntegration
        provider="x"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        '/posts?added=x&msg=Channel Updated'
      )
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

describe('ContinueIntegration two-step save errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'opener', {
      configurable: true,
      writable: true,
      value: null,
    });
  });

  const setupTwoStep = () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        id: 'int-1',
        inBetweenSteps: true,
        pages: [{ id: 'page-1' }],
      })
    );
    render(
      <ContinueIntegration
        provider="facebook"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );
  };

  it('renders the save error inline inside the two-step UI', async () => {
    setupTwoStep();
    mockFetch.mockResolvedValueOnce({
      status: 400,
      json: async () => ({ message: 'Save blew up' }),
    });

    fireEvent.click(await screen.findByText('Save'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Save blew up')
    );
    // The two-step UI is still on screen (no top-level error swap).
    expect(screen.getByText('Configure Your Channel')).toBeTruthy();
  });

  it('captures exceptions to Sentry and shows the inline error on network failure', async () => {
    setupTwoStep();
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    fireEvent.click(await screen.findByText('Save'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Failed to save channel configuration')
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      { extra: { provider: 'facebook', integrationId: 'int-1' } }
    );
  });
});
