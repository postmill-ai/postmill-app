import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { Login } from '@gitroom/frontend/components/auth/login';
import { RegisterAfter } from '@gitroom/frontend/components/auth/register';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// F10: the login/register pages must advertise exactly the providers the
// backend (/auth/providers) returns — no hardcoded fallback. A fresh install
// ({providers:[LOCAL]}) renders no social button on either page.

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
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
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: true,
    genericOauth: false,
    neynarClientId: '',
    billingEnabled: false,
    oauthLogoUrl: '',
    oauthDisplayName: '',
  }),
}));

vi.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => vi.fn(),
}));

vi.mock('@gitroom/react/helpers/use.track', () => ({
  useTrack: () => vi.fn(),
}));

vi.mock('react-use-cookie', () => ({
  default: () => ['', vi.fn()],
}));

// Plain DTO stand-ins: the real ones pull @prisma/client into jsdom, and the
// resolver only runs on submit (not exercised here).
vi.mock('@gitroom/nestjs-libraries/dtos/auth/login.user.dto', () => ({
  LoginUserDto: class LoginUserDto {},
}));
vi.mock('@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto', () => ({
  CreateOrgUserDto: class CreateOrgUserDto {},
}));

// Provider buttons are mocked with sentinels: the spec asserts which buttons
// the pages choose to render, without pulling Solana/Neynar SDKs into jsdom.
vi.mock('@gitroom/frontend/components/auth/providers/google.provider', () => ({
  GoogleProvider: () => <div data-testid="google-provider" />,
}));
vi.mock('@gitroom/frontend/components/auth/providers/github.provider', () => ({
  GithubProvider: () => <div data-testid="github-provider" />,
}));
vi.mock('@gitroom/frontend/components/auth/providers/oauth.provider', () => ({
  OauthProvider: () => <div data-testid="oauth-provider" />,
}));
vi.mock(
  '@gitroom/frontend/components/auth/providers/farcaster.provider',
  () => ({
    FarcasterProvider: () => <div data-testid="farcaster-provider" />,
  })
);
vi.mock('@gitroom/frontend/components/auth/providers/wallet.provider', () => ({
  default: () => <div data-testid="wallet-provider" />,
}));
vi.mock(
  '@gitroom/frontend/components/auth/providers/placeholder/wallet.ui.provider',
  () => ({
    WalletUiProvider: () => <div data-testid="wallet-ui-provider" />,
  })
);

const mockedUseFetch = useFetch as Mock;

const SOCIAL_TESTIDS = [
  'google-provider',
  'github-provider',
  'oauth-provider',
  'farcaster-provider',
  'wallet-provider',
];

const LOCAL_ONLY = [{ provider: 'LOCAL', displayName: 'Email' }];
const LOCAL_AND_GOOGLE = [
  { provider: 'LOCAL', displayName: 'Email' },
  { provider: 'GOOGLE', displayName: 'Google' },
];

function mockProviders(providers: { provider: string; displayName: string }[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/auth/providers') {
      return { ok: true, json: async () => ({ providers }) };
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  });
  mockedUseFetch.mockReturnValue(fetchMock);
  return fetchMock;
}

function renderWithFreshSWR(ui: React.ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>
  );
}

// Wait until the /auth/providers SWR fetch has fired and its resolution +
// re-render have been flushed, so "no button" assertions are not vacuous.
async function settleProvidersFetch(fetchMock: Mock) {
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/auth/providers')
  );
  await act(async () => {});
}

function expectNoSocialButton() {
  for (const testId of SOCIAL_TESTIDS) {
    expect(screen.queryByTestId(testId)).toBeNull();
  }
}

describe('Login social providers (F10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only the email/password form when the backend returns [LOCAL]', async () => {
    const fetchMock = mockProviders(LOCAL_ONLY);

    renderWithFreshSWR(<Login />);
    await settleProvidersFetch(fetchMock);

    expectNoSocialButton();
    expect(screen.getByPlaceholderText('Email Address')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('renders the Google button when the backend advertises GOOGLE', async () => {
    mockProviders(LOCAL_AND_GOOGLE);

    renderWithFreshSWR(<Login />);

    expect(await screen.findByTestId('google-provider')).toBeTruthy();
    expect(screen.queryByTestId('github-provider')).toBeNull();
    expect(screen.queryByTestId('oauth-provider')).toBeNull();
  });
});

describe('Register social providers (F10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches /auth/providers and renders only the email/password form when it returns [LOCAL]', async () => {
    const fetchMock = mockProviders(LOCAL_ONLY);

    renderWithFreshSWR(<RegisterAfter token="" provider="LOCAL" />);
    await settleProvidersFetch(fetchMock);

    expectNoSocialButton();
    expect(screen.getByPlaceholderText('Email Address')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('renders the Google button when the backend advertises GOOGLE', async () => {
    mockProviders(LOCAL_AND_GOOGLE);

    renderWithFreshSWR(<RegisterAfter token="" provider="LOCAL" />);

    expect(await screen.findByTestId('google-provider')).toBeTruthy();
    expect(screen.queryByTestId('github-provider')).toBeNull();
    expect(screen.queryByTestId('oauth-provider')).toBeNull();
  });
});
