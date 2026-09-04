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
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/channels/config/cfg-1');
    const body = JSON.parse((init as RequestInit).body as string);
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

  beforeEach(() => {
    vi.clearAllMocks();
    window.open = openSpy;
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

  it('saves the set, then opens the OAuth url in a popup bound to that set', async () => {
    mockFetch
      // POST /channels/config → created set
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cfg-1' }) })
      // GET /integrations/social/:identifier?config=cfg-1 → OAuth url
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://oauth.example/auth' }),
      });
    openSpy.mockReturnValue({ closed: false });

    renderForm(true, { withSetup: true });
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'My IG set' } }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with Instagram (Standalone)' })
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    const [createUrl, createInit] = mockFetch.mock.calls[0];
    expect(createUrl).toBe('/channels/config');
    expect(JSON.parse((createInit as RequestInit).body as string)).toMatchObject({
      identifier: 'instagram-standalone',
      name: 'My IG set',
    });
    expect(mockFetch.mock.calls[1][0]).toBe(
      '/integrations/social/instagram-standalone?config=cfg-1'
    );
    expect(openSpy).toHaveBeenCalledWith(
      'https://oauth.example/auth',
      'postmill-oauth',
      'width=640,height=720,popup'
    );
  });

  it('closes and refreshes when the popup posts postmill:channel-connected', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cfg-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://oauth.example/auth' }),
      });
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
  });

  it('ignores completion messages from a foreign origin', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cfg-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://oauth.example/auth' }),
      });
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
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'cfg-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ err: true }) });

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
