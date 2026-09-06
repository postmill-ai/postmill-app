import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

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

const mockToast = vi.fn();
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToast }),
}));

vi.mock('@postmill-ai/frontend/components/settings/vpn/hooks/useVpnConfig', () => ({
  useVpnConfig: () => ({ data: undefined }),
}));

vi.mock(
  '@postmill-ai/frontend/components/settings/shared/provider-version-select',
  () => ({
    ProviderVersionSelect: () => null,
    useProviderVersionSelection: () => ({
      versions: [],
      selected: undefined,
      selectVersion: vi.fn(),
    }),
  })
);

vi.mock(
  '@postmill-ai/frontend/components/campaigns/selector/campaign-selector',
  () => ({
    CampaignSelector: () => null,
  })
);

vi.mock('@postmill-ai/frontend/components/launches/web3/web3.list', () => ({
  web3List: [
    {
      identifier: 'telegram',
      component: (props: {
        nonce: string;
        onComplete?: (code: string | number, state: string) => void;
      }) => (
        <div data-testid="web3-connect" data-nonce={props.nonce}>
          {/* Telegram hands back a NUMERIC chat id — the modal must coerce. */}
          <button
            data-testid="web3-complete"
            onClick={() => props.onComplete?.(8861130977, props.nonce)}
          />
        </div>
      ),
    },
  ],
}));

import { ChannelConfigForm } from './channel-edit.modal';

const CREDENTIALS_WARNING =
  'Please enter a Client ID / API Key before enabling this provider.';

const OAUTH_SETUP = {
  authType: 'oauth2' as const,
  credentialFields: [
    { key: 'clientId', label: 'App ID' },
    { key: 'clientSecret', label: 'App Secret', secret: true },
  ],
  setupSteps: ['Create an app', 'Paste the keys'],
};

const EDIT_CONFIG = {
  id: 'cfg-1',
  name: 'My IG set',
  enabled: false,
  scopes: '',
  redirectUri: '',
  setupNotes: '',
  isConfigured: false,
};

function renderForm(
  platformConfigured: boolean,
  opts: { withSetup?: boolean; edit?: boolean } = {}
) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    // Isolated SWR cache per render — the modal's /integrations/list fetch
    // must not see another test's cached response.
    <SWRConfig value={{ provider: () => new Map() }}>
      <ChannelConfigForm
        identifier="instagram-standalone"
        providerName="Instagram (Standalone)"
        platformConfigured={platformConfigured}
        setup={opts.withSetup ? OAUTH_SETUP : null}
        callbackUrl="https://app.postmill.ai/integrations/social/instagram-standalone"
        defaultScopes="instagram_business_basic, instagram_business_content_publish"
        config={opts.edit ? EDIT_CONFIG : undefined}
        onClose={onClose}
        onSaved={onSaved}
      />
    </SWRConfig>
  );
  return { ...utils, onClose, onSaved };
}

const TOKEN_SETUP = {
  authType: 'token' as const,
  credentialFields: [{ key: 'clientId', label: 'Bot Token', secret: true }],
  setupSteps: ['Create a bot', 'Paste the token'],
};

function renderTokenForm(
  identifier: 'telegram' | 'line',
  opts: { platformConfigured?: boolean; edit?: boolean } = {}
) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ChannelConfigForm
        identifier={identifier}
        providerName={identifier === 'telegram' ? 'Telegram' : 'LINE'}
        platformConfigured={opts.platformConfigured ?? true}
        setup={TOKEN_SETUP}
        config={
          opts.edit
            ? { ...EDIT_CONFIG, id: 'cfg-tok', isConfigured: true }
            : undefined
        }
        onClose={onClose}
        onSaved={onSaved}
      />
    </SWRConfig>
  );
  return { ...utils, onClose, onSaved };
}

describe('ChannelConfigForm enable switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('is hidden before setup (create mode)', () => {
    renderForm(true, { withSetup: true });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('allows enabling without a Client ID when a platform app is configured', () => {
    renderForm(true, { edit: true });
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(mockToast).not.toHaveBeenCalledWith(CREDENTIALS_WARNING, 'warning');
  });

  it('blocks enabling without a Client ID when no platform app is configured', () => {
    renderForm(false, { edit: true });
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(mockToast).toHaveBeenCalledWith(CREDENTIALS_WARNING, 'warning');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('saves an enabled credential set without clientId when a platform app is configured', async () => {
    renderForm(true, { edit: true });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => u === '/channels/config/cfg-1')
      ).toBe(true)
    );
    const saveCall = mockFetch.mock.calls.find(([u]) => u === '/channels/config/cfg-1');
    const body = JSON.parse((saveCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ name: 'My IG set', enabled: true });
    expect(body.clientId).toBeUndefined();
    expect(mockToast).toHaveBeenCalledWith('Channel saved', 'success');
  });
});

describe('ChannelConfigForm layout modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('platform-app mode collapses setup steps, callback and scopes under Advanced', () => {
    renderForm(true, { withSetup: true });
    expect(screen.queryByText('How to set this up')).toBeNull();
    expect(screen.queryByText('Callback URL')).toBeNull();
    expect(screen.queryByText("Permissions we'll request")).toBeNull();
    expect(screen.queryByText('App ID')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText('How to set this up')).toBeTruthy();
    expect(screen.getByText('Callback URL')).toBeTruthy();
    expect(screen.getByText("Permissions we'll request")).toBeTruthy();
    expect(screen.getByText('App ID')).toBeTruthy();
  });

  it('BYO mode shows setup steps, callback, scopes and credentials as primary content', () => {
    renderForm(false, { withSetup: true });
    expect(screen.getByText('How to set this up')).toBeTruthy();
    expect(screen.getByText('Callback URL')).toBeTruthy();
    expect(screen.getByText("Permissions we'll request")).toBeTruthy();
    expect(screen.getByText('App ID')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Advanced/ })).toBeNull();
  });
});

describe('ChannelConfigForm platform-app connect', () => {
  const openSpy = vi.fn();

  // The modal SWR-fetches /integrations/list on mount — key all mocks on URL
  // so the list call never consumes a sequenced mock.
  const mockConnectSequence = (
    social: { url?: string; err?: boolean },
    integrations: any[] = []
  ) =>
    mockFetch.mockImplementation((url: string) => {
      if (url === '/integrations/list') {
        return Promise.resolve({ ok: true, json: async () => ({ integrations }) });
      }
      if (url === '/channels/config') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'cfg-1' }) });
      }
      if (url.startsWith('/integrations/social/')) {
        return Promise.resolve({
          ok: true,
          json: async () => (social.err ? { err: true } : { url: social.url }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

  beforeEach(() => {
    vi.clearAllMocks();
    window.open = openSpy;
    mockFetch.mockImplementation((url: string) => {
      if (url === '/integrations/list') {
        return Promise.resolve({ ok: true, json: async () => ({ integrations: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    delete (window as { open?: unknown }).open;
  });

  it('shows the Connect button only for OAuth providers with a platform app', () => {
    const { unmount } = renderForm(true, { withSetup: true });
    const button = screen.getByRole('button', {
      name: 'Connect with Instagram (Standalone)',
    });
    expect(button.className).toContain('w-full');
    expect(button.className).toContain('whitespace-nowrap');
    unmount();

    renderForm(false, { withSetup: true });
    expect(
      screen.queryByRole('button', { name: 'Connect with Instagram (Standalone)' })
    ).toBeNull();
  });

  it('shows the connected channel and offers Connect another account', async () => {
    mockConnectSequence({}, [
      {
        identifier: 'instagram-standalone',
        name: 'Postmill',
        disabled: false,
        inBetweenSteps: false,
      },
    ]);
    renderForm(true, { withSetup: true, edit: true });
    expect(await screen.findByText('Connected as Postmill')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Connect another account' })
    ).toBeTruthy();
  });

  it('saves the set, then opens the OAuth url in a popup bound to that set', async () => {
    mockConnectSequence({ url: 'https://oauth.example/auth' });
    openSpy.mockReturnValue({ closed: false });

    renderForm(true, { withSetup: true });
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'My IG set' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Instagram (Standalone)' })
    );

    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => u === '/channels/config')
      ).toBe(true)
    );
    const createCall = mockFetch.mock.calls.find(([u]) => u === '/channels/config');
    // A set must not be enabled before it is set up — Connect creates it
    // disabled and enables it after a successful connect.
    expect(JSON.parse((createCall![1] as RequestInit).body as string)).toMatchObject({
      identifier: 'instagram-standalone',
      name: 'My IG set',
      enabled: false,
    });
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://oauth.example/auth',
        'postmill-oauth',
        'width=640,height=720,popup'
      )
    );
    expect(
      mockFetch.mock.calls.some(
        ([u]) => u === '/integrations/social/instagram-standalone?config=cfg-1'
      )
    ).toBe(true);
  });

  it('closes and refreshes when the popup posts postmill:channel-connected', async () => {
    mockConnectSequence({ url: 'https://oauth.example/auth' });
    openSpy.mockReturnValue({ closed: false });

    const { onClose, onSaved } = renderForm(true, { withSetup: true });
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'My IG set' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Instagram (Standalone)' })
    );
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'postmill:channel-connected', provider: 'instagram-standalone' },
        origin: window.location.origin,
      })
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Channel Connected!', 'success');

    // A successful connect enables the now-set-up credential set.
    const enableCall = mockFetch.mock.calls.find(
      ([u, init]) =>
        u === '/channels/config/cfg-1' && (init as RequestInit)?.method === 'PUT'
    );
    expect(enableCall).toBeTruthy();
    expect(JSON.parse((enableCall![1] as RequestInit).body as string)).toEqual({
      enabled: true,
    });
  });

  it('ignores completion messages from a foreign origin', async () => {
    mockConnectSequence({ url: 'https://oauth.example/auth' });
    openSpy.mockReturnValue({ closed: false });

    const { onClose } = renderForm(true, { withSetup: true });
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'My IG set' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Instagram (Standalone)' })
    );
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'postmill:channel-connected', provider: 'instagram-standalone' },
        origin: 'https://evil.example',
      })
    );

    expect(onClose).not.toHaveBeenCalled();
  });

  it('warns instead of opening a popup when the initiation returns err', async () => {
    mockConnectSequence({ err: true });

    renderForm(true, { withSetup: true });
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'My IG set' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Instagram (Standalone)' })
    );

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'Could not connect to the platform',
        'warning'
      )
    );
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('ChannelConfigForm token connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url === '/integrations/list') {
        return Promise.resolve({ ok: true, json: async () => ({ integrations: [] }) });
      }
      if (url === '/channels/config') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'cfg-tok' }) });
      }
      if (url.startsWith('/integrations/social/')) {
        return Promise.resolve({ ok: true, json: async () => ({ url: 'nonce-123' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('platform-app mode shows Connect and collapses the bot token under Advanced', () => {
    renderTokenForm('telegram');
    expect(
      screen.getByRole('button', { name: 'Connect with Telegram' })
    ).toBeTruthy();
    expect(screen.queryByText('Bot Token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText('Bot Token')).toBeTruthy();
  });

  it('telegram: Connect renders the interactive connect view with the minted nonce', async () => {
    renderTokenForm('telegram');
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'TG set' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Telegram' }));

    const view = await screen.findByTestId('web3-connect');
    expect(view.getAttribute('data-nonce')).toBe('nonce-123');
    expect(
      mockFetch.mock.calls.some(
        ([u]) => u === '/integrations/social/telegram?config=cfg-tok'
      )
    ).toBe(true);
    // Back returns to the form.
    fireEvent.click(screen.getByText('Back'));
    expect(screen.queryByTestId('web3-connect')).toBeNull();
  });

  it('line (no interactive component): Connect completes the token-validation connect inline', async () => {
    const { onClose, onSaved } = renderTokenForm('line');
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'LINE set' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect with LINE' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Inline social-connect POST — no full-page redirect through
    // continue.integration (a failure there dumped the user on /posts).
    const call = mockFetch.mock.calls.find(
      ([u]) => u === '/integrations/social-connect/line'
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({
      state: 'nonce-123',
      code: 'connect',
      timezone: expect.any(String),
    });
    // Success: the set is flipped enabled and the modal reports it.
    expect(
      mockFetch.mock.calls.some(
        ([u, o]) =>
          u === '/channels/config/cfg-tok' &&
          o?.method === 'PUT' &&
          JSON.parse(o.body).enabled === true
      )
    ).toBe(true);
    expect(onSaved).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Channel Connected!', 'success');
    expect(screen.queryByTestId('web3-connect')).toBeNull();
  });

  it('telegram: completing the interactive connect posts to social-connect inline', async () => {
    const { onClose, onSaved } = renderTokenForm('telegram');
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'TG set' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Telegram' }));
    fireEvent.click(await screen.findByTestId('web3-complete'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const call = mockFetch.mock.calls.find(
      ([u]) => u === '/integrations/social-connect/telegram'
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toEqual({
      state: 'nonce-123',
      // Numeric chat id from the connect component is coerced to a string
      // (ConnectIntegrationDto rejects non-string codes with a 400).
      code: '8861130977',
      timezone: expect.any(String),
    });
    expect(onSaved).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Channel Connected!', 'success');
  });

  it('telegram: expired state returns to the form with a retry message (no page dump)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/integrations/list') {
        return Promise.resolve({ ok: true, json: async () => ({ integrations: [] }) });
      }
      if (url === '/channels/config') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'cfg-tok' }) });
      }
      if (url.startsWith('/integrations/social-connect/')) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ message: 'Invalid or expired state' }),
        });
      }
      if (url.startsWith('/integrations/social/')) {
        return Promise.resolve({ ok: true, json: async () => ({ url: 'nonce-123' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderTokenForm('telegram');
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'TG set' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Telegram' }));
    fireEvent.click(await screen.findByTestId('web3-complete'));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'Connect session expired — please try again',
        'warning'
      )
    );
    // Back on the form: the next Connect click mints a fresh state.
    expect(screen.queryByTestId('web3-connect')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Connect with Telegram' })
    ).toBeTruthy();
  });

  it('failed connect retry updates the same set instead of POSTing a duplicate (409)', async () => {
    let connectCalls = 0;
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (url === '/integrations/list') {
        return Promise.resolve({ ok: true, json: async () => ({ integrations: [] }) });
      }
      if (url === '/channels/config' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'cfg-tok' }) });
      }
      if (url === '/channels/config/cfg-tok' && opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url.startsWith('/integrations/social-connect/')) {
        connectCalls += 1;
        return connectCalls === 1
          ? Promise.resolve({ ok: false, json: async () => ({ message: 'LINE channel access token was rejected' }) })
          : Promise.resolve({ ok: true, json: async () => ({ id: 'int-1' }) });
      }
      if (url.startsWith('/integrations/social/')) {
        return Promise.resolve({ ok: true, json: async () => ({ url: 'nonce-123' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { onClose } = renderTokenForm('line');
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'LINE set' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect with LINE' }));
    // First connect fails — the modal stays open on the form.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        'LINE channel access token was rejected',
        'warning'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect with LINE' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Retry saved via PUT on the created set — no duplicate POST.
    expect(
      mockFetch.mock.calls.some(
        ([u, o]) => u === '/channels/config/cfg-tok' && o?.method === 'PUT'
      )
    ).toBe(true);
    expect(
      mockFetch.mock.calls.filter(
        ([u, o]) => u === '/channels/config' && o?.method === 'POST'
      )
    ).toHaveLength(1);
    expect(mockToast).toHaveBeenCalledWith('Channel Connected!', 'success');
  });
});

const DIRECT_SETUP = {
  authType: 'direct' as const,
  credentialFields: [],
  setupSteps: ['Create an app password', 'Enter your handle'],
};

const DIRECT_CUSTOM_FIELDS = [
  {
    key: 'service',
    label: 'Service',
    defaultValue: 'https://bsky.social',
    validation: '/^https?:\\/\\/.+$/',
    type: 'text' as const,
  },
  { key: 'identifier', label: 'Identifier', validation: '/^.+$/', type: 'text' as const },
  { key: 'password', label: 'Password', validation: '/^.{3,}$/', type: 'password' as const },
];

function renderDirectForm() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ChannelConfigForm
        identifier="bluesky"
        providerName="Bluesky"
        platformConfigured={false}
        setup={DIRECT_SETUP}
        customFields={DIRECT_CUSTOM_FIELDS}
        onClose={onClose}
        onSaved={onSaved}
      />
    </SWRConfig>
  );
  return { ...utils, onClose, onSaved };
}

describe('ChannelConfigForm direct connect (customFields)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url === '/integrations/list') {
        return Promise.resolve({ ok: true, json: async () => ({ integrations: [] }) });
      }
      if (url === '/channels/config') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'cfg-bsky' }) });
      }
      if (url.startsWith('/integrations/social/')) {
        return Promise.resolve({ ok: true, json: async () => ({ url: 'nonce-bsky' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('renders the account-credential fields and Connect button', () => {
    renderDirectForm();
    expect(screen.getByText('Identifier')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Connect with Bluesky' })
    ).toBeTruthy();
  });

  it('rejects invalid field values before saving', () => {
    renderDirectForm();
    fireEvent.change(screen.getByPlaceholderText('e.g. Marketing LinkedIn'), {
      target: { value: 'Bluesky set' },
    });
    // Identifier empty — fails its /^.+$/ validation.
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Bluesky' }));
    expect(mockToast).toHaveBeenCalledWith('Identifier is invalid', 'warning');
    expect(
      mockFetch.mock.calls.some(([u]) => u === '/channels/config')
    ).toBe(false);
  });

  it('saves the set ENABLED, then completes the connect inline with base64(JSON) code', async () => {
    const { onClose, onSaved } = renderDirectForm();
    fireEvent.change(screen.getByPlaceholderText('e.g. Marketing LinkedIn'), {
      target: { value: 'Bluesky set' },
    });
    fireEvent.change(screen.getByDisplayValue('https://bsky.social'), {
      target: { value: 'https://bsky.social' },
    });
    const inputs = screen.getAllByDisplayValue('');
    fireEvent.change(inputs[0], { target: { value: 'postmill.bsky.social' } });
    fireEvent.change(inputs[1], { target: { value: 'app-password-x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect with Bluesky' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Direct sets enable up front: connect initiation is gated on an enabled
    // set, and direct sets hold no app credentials to wait for.
    const createCall = mockFetch.mock.calls.find(([u]) => u === '/channels/config');
    expect(JSON.parse(createCall![1].body).enabled).toBe(true);
    // State minted against the saved set.
    expect(
      mockFetch.mock.calls.some(
        ([u]) => u === '/integrations/social/bluesky?config=cfg-bsky'
      )
    ).toBe(true);
    // Inline social-connect POST — code is base64(JSON) of the field values,
    // the same payload the old composer connect flow posted.
    const connectCall = mockFetch.mock.calls.find(
      ([u]) => u === '/integrations/social-connect/bluesky'
    );
    expect(connectCall).toBeTruthy();
    const body = JSON.parse(connectCall![1].body);
    expect(body.state).toBe('nonce-bsky');
    expect(JSON.parse(atob(body.code))).toEqual({
      service: 'https://bsky.social',
      identifier: 'postmill.bsky.social',
      password: 'app-password-x',
    });
    expect(onSaved).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Channel Connected!', 'success');
  });
});
