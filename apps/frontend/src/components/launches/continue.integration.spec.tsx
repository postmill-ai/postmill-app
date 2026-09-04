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

const mockCaptureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: any[]) => mockCaptureException(...args),
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

  beforeEach(() => {
    vi.clearAllMocks();
    closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      writable: true,
      value: null,
    });
    closeSpy.mockRestore();
  });

  const setOpener = (opener: unknown) =>
    Object.defineProperty(window, 'opener', {
      configurable: true,
      writable: true,
      value: opener,
    });

  it('posts postmill:channel-connected to the opener and closes the popup on success', async () => {
    setOpener({ postMessage });
    mockFetch.mockResolvedValue(okResponse({ id: 'int-1', inBetweenSteps: false }));

    render(
      <ContinueIntegration
        provider="x"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'postmill:channel-connected',
        provider: 'x',
        message: 'Channel Updated',
      },
      window.location.origin
    );
    expect(closeSpy).toHaveBeenCalled();
    // The popup must not navigate to /posts — the opener owns the refresh.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates in-window as before when there is no popup opener', async () => {
    setOpener(null);
    mockFetch.mockResolvedValue(okResponse({ id: 'int-1', inBetweenSteps: false }));

    render(
      <ContinueIntegration
        provider="x"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/posts?added=x&msg=Channel Updated')
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('keeps rendering the two-step selection inside the popup (no early close)', async () => {
    setOpener({ postMessage });
    mockFetch.mockResolvedValue(
      okResponse({ id: 'int-1', inBetweenSteps: true, pages: [] })
    );

    render(
      <ContinueIntegration
        provider="facebook"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Two-step means the user still has to pick a page — no completion yet.
    expect(postMessage).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('shows a failed page save inline, reports it, and keeps the two-step UI', async () => {
    setOpener({ postMessage });
    mockFetch
      // social-connect → two-step with pages
      .mockResolvedValueOnce(
        okResponse({ id: 'int-1', inBetweenSteps: true, pages: [{ id: 'p1' }] })
      )
      // page save → rejected by the backend
      .mockResolvedValueOnce({
        status: 400,
        json: async () => ({ message: 'Invalid request' }),
      });

    render(
      <ContinueIntegration
        provider="facebook"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    fireEvent.click(await screen.findByText('Save'));

    // The save body carries only the selection + state — never the OAuth
    // callback params (the global pipe 400s on `code`).
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          ([u]) => u === '/integrations/provider/int-1/connect'
        )
      ).toBe(true)
    );
    const saveCall = mockFetch.mock.calls.find(
      ([u]) => u === '/integrations/provider/int-1/connect'
    );
    expect(JSON.parse((saveCall![1] as RequestInit).body as string)).toEqual({
      state: 's',
      page: 'page-1',
    });

    // The failure reason renders inside the two-step UI — previously the error
    // state was set but never displayed, so Save appeared to do nothing.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid request');
    expect(mockCaptureException).toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    // A retry clears the previous message while in flight.
    mockFetch.mockResolvedValueOnce(okResponse({}));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).toBeNull()
    );
  });
});
