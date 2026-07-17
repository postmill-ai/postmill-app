import React from 'react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from '@testing-library/react';

// The page reads OAuth params off the URL and talks to /oauth/authorize through
// useFetch; stub both so we can drive the consent flow deterministically (3.3).
let searchParamValues: Record<string, string> = {};
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamValues[key] ?? null,
  }),
}));

const fetchMock = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import OAuthAuthorizePage from './page';

// A valid pre-consent GET response so the consent card (with the scope list and
// the Authorize/Deny buttons) renders.
const validAppInfo = {
  app: { name: 'Test App', description: 'A test client' },
};

// The pre-consent GET is a bare fetch(url); the action POST passes { method }.
const wireFetch = (postResponse: any) => {
  fetchMock.mockImplementation((_url: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST') {
      return Promise.resolve({ json: () => Promise.resolve(postResponse) });
    }
    return Promise.resolve({ json: () => Promise.resolve(validAppInfo) });
  });
};

describe('OAuthAuthorizePage (3.3)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    searchParamValues = {
      client_id: 'abc',
      response_type: 'code',
      redirect_uri: 'https://client.example/callback',
    };
  });
  afterEach(() => cleanup());

  it('pre-consent GET forwards redirect_uri and scope so a mismatch errors before Authorize', async () => {
    searchParamValues.scope = 'mcp:read mcp:posts:write';
    wireFetch({ redirect: 'https://client.example/callback?code=x' });

    render(<OAuthAuthorizePage />);
    await screen.findByText('Test App');

    const getUrl = fetchMock.mock.calls[0][0] as string;
    expect(getUrl).toContain('redirect_uri=');
    expect(getUrl).toContain('scope=');
  });

  it('a 400 from the authorize POST shows the error message instead of dead-ending', async () => {
    wireFetch({ statusCode: 400, message: 'redirect_uri mismatch' });

    render(<OAuthAuthorizePage />);
    const authorize = await screen.findByText('Authorize');

    // Before the click the buttons must be enabled (not stuck disabled).
    expect((authorize as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(authorize);

    // The dead-end (permanently-disabled, message-less) state is gone: the
    // error message surfaces and submitting is reset.
    await screen.findByText('redirect_uri mismatch');
    // The old "Authorize" button is no longer rendered stuck-disabled — the
    // error screen replaced the consent card entirely.
    expect(screen.queryByText('Authorize')).toBeNull();
  });

  it('falls back to a generic message when the POST failure has no message', async () => {
    wireFetch({ statusCode: 400 });

    render(<OAuthAuthorizePage />);
    fireEvent.click(await screen.findByText('Authorize'));

    await screen.findByText('Authorization failed');
  });

  it('deduplicates repeated scopes (no duplicate React keys)', async () => {
    searchParamValues.scope = 'mcp:read mcp:read';
    wireFetch({ redirect: 'x' });

    render(<OAuthAuthorizePage />);
    await screen.findByText('Test App');

    const items = screen.getAllByText(
      'Read your integrations, posts, and analytics'
    );
    expect(items).toHaveLength(1);
  });

  it('renders an unknown scope with the Unrecognized-scope marker, not verbatim prose', async () => {
    // A client-authored scope id (not in SCOPE_LABELS) must never render as a
    // reassuring prose label — only as a marked, raw, monospace token.
    searchParamValues.scope = 'read-only-public-data';
    wireFetch({ redirect: 'x' });

    render(<OAuthAuthorizePage />);
    await screen.findByText('Test App');

    // The raw string is shown inside a muted monospace <code>, never as prose.
    const code = await screen.findByText('read-only-public-data');
    expect(code.tagName.toLowerCase()).toBe('code');
    expect(code.className).toContain('font-mono');
    // Its <li> carries the explicit "Unrecognized scope:" marker.
    const li = code.closest('li');
    expect(li?.textContent).toContain('Unrecognized scope:');
  });
});
