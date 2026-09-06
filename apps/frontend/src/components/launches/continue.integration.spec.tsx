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
        // X (OAuth 1.0a) calls back with oauth_token/oauth_verifier.
        searchParams={{ oauth_token: 't', oauth_verifier: 'v' }}
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
        // X (OAuth 1.0a) calls back with oauth_token/oauth_verifier.
        searchParams={{ oauth_token: 't', oauth_verifier: 'v' }}
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

  it('never redirects a popup on failure, reports status+body, and shows the status', async () => {
    setOpener({ postMessage });
    // A non-OK response with NO error message in the body (the "Could not add
    // provider" case from the Discord failure) must still be diagnosable.
    mockFetch.mockResolvedValue({ status: 403, json: async () => ({}) });

    render(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    // The status-bearing fallback is shown (not the bare generic message)…
    await screen.findByText('Could not add provider (error 403)');
    // …and the popup is told to close manually, NOT that it is redirecting.
    expect(screen.queryByText('You are being redirected back')).toBeNull();
    // The failure is reported with full context.
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Channel connect failed for discord: HTTP 403',
      }),
      { extra: { provider: 'discord', status: 403, body: {} } }
    );
    // No popup navigation, no postMessage, no close.
    expect(mockPush).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('sends only DTO-whitelisted fields in the connect body, never raw callback params', async () => {
    setOpener({ postMessage });
    mockFetch.mockResolvedValue(okResponse({ id: 'int-1', inBetweenSteps: false }));

    render(
      <ContinueIntegration
        provider="discord"
        // Discord's callback carries guild_id/permissions — the global
        // forbidNonWhitelisted pipe 400s when they leak into the POST body.
        searchParams={{
          state: 's',
          code: 'c',
          guild_id: '1545788148620202066',
          permissions: '377957124096',
        }}
        logged={true}
      />
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/integrations/social-connect/discord');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      state: 's',
      code: 'c',
      timezone: '0',
    });
  });

  it('shows a ValidationPipe array message on a 400 instead of the bare fallback (single body read)', async () => {
    setOpener({ postMessage });
    mockFetch.mockResolvedValue({
      status: 400,
      json: async () => ({
        message: ['property guild_id should not exist'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    });

    render(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    // The real reason is displayed — previously the body was read twice and
    // the second .json() threw, leaving a message-less fallback.
    await screen.findByText('property guild_id should not exist');
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Channel connect failed for discord: property guild_id should not exist',
      }),
      expect.anything()
    );
  });

  it('redirects the full-page flow on failure as before (not a popup)', async () => {
    setOpener(null);
    mockFetch.mockResolvedValue({ status: 500, json: async () => ({}) });

    render(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await screen.findByText('Could not add provider (error 500)');
    // The popup-only copy must not appear in the full-page flow.
    expect(
      screen.queryByText('You can close this window and try again.')
    ).toBeNull();
  });

  it('surfaces a network-level fetch failure instead of hanging on Adding Channel', async () => {
    setOpener({ postMessage });
    mockFetch.mockRejectedValue(new Error('socket hangup'));

    render(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );

    await screen.findByText('Network error while connecting the channel');
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'socket hangup' }),
      { extra: { provider: 'discord' } }
    );
  });

  it('shows a clean reason on a code-less callback instead of the raw DTO validation message', async () => {
    setOpener({ postMessage });

    render(
      <ContinueIntegration
        provider="linkedin"
        searchParams={{ state: 's' }}
        logged={true}
      />
    );

    // Never POSTs — an undefined `code` would only 400 with "code must be a
    // string" (POSTMILL-APP-9).
    await screen.findByText(
      'Authorization did not complete — no authorization code was returned. Please try connecting again.'
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Channel connect failed for linkedin: callback missing authorization code',
      }),
      expect.anything()
    );
  });

  it('shows the provider error on an OAuth error redirect and reports it', async () => {
    setOpener({ postMessage });

    render(
      <ContinueIntegration
        provider="linkedin"
        searchParams={{
          state: 's',
          error: 'unauthorized_scope_error',
          error_description: 'Scope &quot;rw_organization_admin&quot; is not authorized',
        }}
        logged={true}
      />
    );

    await screen.findByText(
      'Authorization failed: unauthorized_scope_error: Scope &quot;rw_organization_admin&quot; is not authorized'
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalled();
  });

  it('treats a user-cancelled consent as normal flow — clean message, no Sentry noise', async () => {
    setOpener({ postMessage });

    render(
      <ContinueIntegration
        provider="linkedin"
        searchParams={{
          state: 's',
          error: 'access_denied',
          error_description: 'The user cancelled the authorization',
        }}
        logged={true}
      />
    );

    await screen.findByText(
      'Authorization was cancelled — nothing was connected.'
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('treats an X OAuth 1.0a denial (?denied=) as a cancellation, not an error', async () => {
    setOpener({ postMessage });

    render(
      <ContinueIntegration
        provider="x"
        searchParams={{ denied: 'some-oauth-token' }}
        logged={true}
      />
    );

    await screen.findByText(
      'Authorization was cancelled — nothing was connected.'
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('fires the connect POST exactly once across re-renders (single-use state)', async () => {
    setOpener({ postMessage });
    mockFetch.mockResolvedValue(okResponse({ id: 'int-1', inBetweenSteps: false }));

    const { rerender } = render(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Re-renders with fresh prop identities (Next.js re-serializing
    // searchParams, parent updates) must not re-fire the effect — the OAuth
    // state+code are spent by the first POST, and a second one surfaces a
    // false "Could not add provider" error in the popup after a SUCCESS.
    rerender(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c' }}
        logged={true}
      />
    );
    rerender(
      <ContinueIntegration
        provider="discord"
        searchParams={{ state: 's', code: 'c', refresh: '' }}
        logged={true}
      />
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
