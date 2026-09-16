import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { Register } from '@postmill-ai/frontend/components/auth/register';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import {
  isSsoPopupCallback,
  markSsoFullPage,
  resetSsoCallbackMode,
  SSO_COMPLETE_STORAGE_KEY,
} from '@postmill-ai/frontend/components/auth/sso-popup';

// The /auth?provider=…&code=… callback page: the OAuth code exchange runs
// inside the sign-in popup (or the user's own tab after a popup-blocked
// fallback). It must (a) forward the provider's `state` so X can find its
// PKCE verifier, (b) decide the popup/full-page mode before the exchange so
// LayoutContext.afterRequest routes the auth headers correctly, and (c) show
// a failure instead of spinning forever — reporting it to the opener when in
// a popup.

let searchParams = new URLSearchParams();

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(),
}));
vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: true,
    genericOauth: false,
    neynarClientId: '',
    billingEnabled: false,
    oauthLogoUrl: '',
    oauthDisplayName: '',
  }),
}));
vi.mock('@postmill-ai/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => vi.fn(),
}));
vi.mock('@postmill-ai/react/helpers/use.track', () => ({
  useTrack: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-use-cookie', () => ({
  default: () => ['', vi.fn()],
}));
vi.mock('@postmill-ai/nestjs-libraries/dtos/auth/create.org.user.dto', () => ({
  CreateOrgUserDto: class CreateOrgUserDto {},
}));
vi.mock('@hookform/resolvers/class-validator', () => ({
  classValidatorResolver: () => async (values: any) => ({ values, errors: {} }),
}));
vi.mock('@postmill-ai/frontend/components/auth/providers/wallet.provider', () => ({
  default: () => <div data-testid="wallet-provider" />,
}));
vi.mock('@postmill-ai/frontend/components/auth/providers/farcaster.provider', () => ({
  FarcasterProvider: () => <div data-testid="farcaster-provider" />,
}));

const mockedUseFetch = useFetch as Mock;

function mockFetch(existsResponse: any) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/auth/providers') {
      return { ok: true, json: async () => ({ providers: [] }) };
    }
    if (url.endsWith('/exists')) {
      return existsResponse;
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  });
  mockedUseFetch.mockReturnValue(fetchMock);
  return fetchMock;
}

function renderRegister() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Register />
    </SWRConfig>
  );
}

describe('Register — OAuth callback inside the sign-in popup', () => {
  let close: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetSsoCallbackMode();
    Object.defineProperty(window, 'opener', { value: null, writable: true, configurable: true });
    close = vi.spyOn(window, 'close').mockImplementation(() => undefined) as unknown as Mock;
    searchParams = new URLSearchParams('provider=X&code=code-1&state=login.abcdefghijklmnop');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts code AND state to /auth/oauth/:provider/exists and marks the page as a popup callback', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ token: 'provider-token' }) });

    renderRegister();
    await act(async () => {});

    const [url, init] = fetchMock.mock.calls.find(([u]) => u.endsWith('/exists'))!;
    expect(url).toBe('/auth/oauth/X/exists');
    expect(JSON.parse(init.body)).toEqual({ code: 'code-1', state: 'login.abcdefghijklmnop' });
    expect(isSsoPopupCallback()).toBe(true);
    // new user → the Company form renders inside the popup
    await waitFor(() => expect(screen.getByPlaceholderText('Company')).toBeTruthy());
  });

  it('omits state when the provider did not send one', async () => {
    searchParams = new URLSearchParams('provider=GITHUB&code=code-2');
    const fetchMock = mockFetch({ ok: true, json: async () => ({ token: 't' }) });

    renderRegister();
    await act(async () => {});

    const [, init] = fetchMock.mock.calls.find(([u]) => u.endsWith('/exists'))!;
    expect(JSON.parse(init.body)).toEqual({ code: 'code-2' });
  });

  it('treats the page as the user\'s own tab when it carries the full-page marker', async () => {
    markSsoFullPage();
    mockFetch({ ok: true, json: async () => ({ token: 't' }) });

    renderRegister();
    await act(async () => {});

    expect(isSsoPopupCallback()).toBe(false);
  });

  it('on a failed exchange in a popup: reports the error to the opener, closes, and shows it inline as the fallback', async () => {
    mockFetch({ ok: false, status: 400, text: async () => 'X login PKCE verifier missing or expired — restart the login' });

    renderRegister();
    await act(async () => {});

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/PKCE verifier missing/)).toBeTruthy();
    expect(screen.getByText(/close this window/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)!)).toMatchObject({
      action: 'error',
      message: expect.stringContaining('PKCE verifier missing'),
    });
    expect(close).toHaveBeenCalled();
  });

  it('unwraps a Nest JSON error body so the opener sees the message, not the JSON', async () => {
    mockFetch({
      ok: false,
      status: 500,
      text: async () =>
        JSON.stringify({ statusCode: 500, message: 'X profile lookup failed: Forbidden' }),
    });

    renderRegister();
    await act(async () => {});

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('X profile lookup failed: Forbidden')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)!)).toMatchObject({
      action: 'error',
      message: 'X profile lookup failed: Forbidden',
    });
  });

  it('on a failed exchange in the user\'s own tab: shows the error with a way back, no close', async () => {
    markSsoFullPage();
    mockFetch({ ok: false, status: 500, text: async () => 'Invalid user' });

    renderRegister();
    await act(async () => {});

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Invalid user')).toBeTruthy();
    expect(screen.getByText('Back to login')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY)).toBeNull();
  });
});
