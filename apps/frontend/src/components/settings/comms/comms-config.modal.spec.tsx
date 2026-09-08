import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { commsConfigFixture as configData } from './comms.test-fixture';

const mockFetchFn = vi.fn();
const mockToasterShow = vi.fn();
const mockT = vi.fn(
  (_key: string, fallback?: string, vars?: Record<string, string>) =>
    (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (m, k) => vars?.[k] ?? m)
);

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

const mockDecisionOpen = vi.fn().mockResolvedValue(true);
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useDecisionModal: () => ({ open: mockDecisionOpen }),
}));

const defaultFetchImpl = (url: unknown, init?: unknown) => {
  if (typeof url === 'string' && url === '/settings/comms/config' && !init) {
    return Promise.resolve({ ok: true, json: async () => configData });
  }
  if (typeof url === 'string' && url === '/settings/comms/oauth/slack/url' && !init) {
    return Promise.resolve({ ok: true, json: async () => ({ url: 'https://slack.example/oauth' }) });
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({ connectCode: 'ABCD2345', expiresAt: '2026-08-31T00:00:00Z', ok: true }),
    text: async () => '',
  });
};

// GET /settings/comms/config calls so far (SWR loads + refetches).
const configLoadCount = () =>
  mockFetchFn.mock.calls.filter(([u, i]) => u === '/settings/comms/config' && !i).length;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderForm = async (identifier: string, onClose = vi.fn()) => {
  const { CommsConfigForm } = await import('./comms-config.modal');
  const view = render(<CommsConfigForm identifier={identifier} onClose={onClose} />, { wrapper });
  // Wait for the shared SWR fetch to resolve and the inner form to mount.
  await screen.findByText('Bot Token', undefined, { timeout: 3000 }).catch(() => undefined);
  return { view, onClose };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFn.mockImplementation(defaultFetchImpl);
});

describe('CommsConfigForm', () => {
  it('saves credentials via PUT with the enabled flag, omitting blank values', async () => {
    const onClose = vi.fn();
    await renderForm('telegram', onClose);

    const input = await screen.findByPlaceholderText(/saved — leave blank/);
    fireEvent.change(input, { target: { value: 'new-token' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/config/telegram',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ credentials: { botToken: 'new-token' }, enabled: true }),
        }),
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('warns instead of saving when a required credential is missing', async () => {
    await renderForm('slack');

    fireEvent.click(await screen.findByText('Save'));

    await waitFor(() => {
      expect(mockToasterShow).toHaveBeenCalledWith(
        expect.stringContaining('Bot Token'),
        'warning',
      );
    });
    expect(mockFetchFn).not.toHaveBeenCalledWith(
      '/settings/comms/config/slack',
      expect.anything(),
    );
  });

  it('shows the enabled switch only for configured providers', async () => {
    await renderForm('telegram');
    const toggle = await screen.findByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('hides the switch, Test and Remove for unconfigured providers', async () => {
    await renderForm('slack');
    // Slack is a platform provider — credentials live under Advanced.
    fireEvent.click(await screen.findByRole('button', { name: 'Advanced' }));
    expect(await screen.findByText('Signing Secret')).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Test')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('tests the connection and toasts the result', async () => {
    await renderForm('telegram');
    fireEvent.click(await screen.findByText('Test'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/config/telegram/test',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(mockToasterShow).toHaveBeenCalledWith('Connection OK', 'success');
    });
  });

  it('removes the provider after confirmation', async () => {
    const onClose = vi.fn();
    await renderForm('telegram', onClose);
    // The footer Remove (link rows have their own) — scope via the Cancel button.
    const cancel = await screen.findByText('Cancel');
    const footer = cancel.closest('div.justify-between') as HTMLElement;
    fireEvent.click(within(footer).getByText('Remove'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/config/telegram',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('creates a link and reveals the one-time code with provider instructions', async () => {
    await renderForm('telegram');

    fireEvent.click(await screen.findByTestId('comms-add-link'));
    fireEvent.click(screen.getByTestId('member-picker-toggle'));
    fireEvent.click(screen.getByTestId('member-option-user-2'));
    fireEvent.click(screen.getByText('Post failed'));
    fireEvent.click(screen.getByTestId('comms-create-link'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/links',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            identifier: 'telegram',
            userId: 'user-2',
            agentChatEnabled: true,
            categories: { post_failed: true },
          }),
        }),
      );
    });
    expect((await screen.findByTestId('comms-connect-code')).textContent).toBe('ABCD2345');
    expect(screen.getByText(/Open a chat with the bot in Telegram/)).toBeDefined();
  });

  it('warns instead of posting a link without a member', async () => {
    await renderForm('telegram');

    fireEvent.click(await screen.findByTestId('comms-add-link'));
    fireEvent.click(screen.getByTestId('comms-create-link'));

    await waitFor(() => {
      expect(mockToasterShow).toHaveBeenCalledWith(
        'Pick a member and a provider first',
        'warning',
      );
    });
    expect(mockFetchFn).not.toHaveBeenCalledWith('/settings/comms/links', expect.anything());
  });

  it('toggles agent chat on a link via PUT', async () => {
    await renderForm('telegram');

    const row = (await screen.findByText('Maya')).closest('div.border') as HTMLElement;
    fireEvent.click(within(row).getByLabelText('Agent chat'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/links/link-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ agentChatEnabled: false }),
        }),
      );
    });
  });

  it('regenerates the code for a pending link', async () => {
    await renderForm('telegram');

    const row = (await screen.findByText('Maya')).closest('div.border') as HTMLElement;
    fireEvent.click(within(row).getByText('New code'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/links/link-1/regenerate-code',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect((await screen.findByTestId('comms-connect-code')).textContent).toBe('ABCD2345');
  });

  it('deletes a link after confirmation', async () => {
    await renderForm('telegram');

    const row = (await screen.findByText('Maya')).closest('div.border') as HTMLElement;
    fireEvent.click(within(row).getByText('Remove'));

    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/links/link-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});

describe('CommsConfigForm platform vs flat mode', () => {
  it('platform mode: Connect is primary, everything else collapsed under Advanced', async () => {
    await renderForm('slack');

    expect(await screen.findByText('Connect with Slack')).toBeDefined();
    expect(screen.getByText('Uses the Postmill app — no setup needed')).toBeDefined();
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    // Setup content is hidden until Advanced is expanded.
    expect(screen.queryByText('Bot Token')).toBeNull();
    expect(screen.queryByText('Webhook URL')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('platform mode: Advanced defaults expanded when editing a configured provider', async () => {
    await renderForm('telegram');

    const advanced = await screen.findByRole('button', { name: 'Advanced' });
    expect(advanced.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Bot Token')).toBeDefined();
    expect(screen.getByText('Webhook URL')).toBeDefined();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('flat mode (matrix): steps, credentials and webhook are the primary content', async () => {
    await renderForm('matrix');

    expect(await screen.findByText('Homeserver URL')).toBeDefined();
    expect(screen.getByText('Access Token')).toBeDefined();
    // No platform app — no Connect button, no Advanced collapse.
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull();
    expect(screen.queryByText(/Connect with/)).toBeNull();
  });

  it('renders numbered setup steps as an ordered list, with setupNotes as a caption', async () => {
    await renderForm('matrix');

    const steps = await screen.findAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([
      'Create a bot account on your homeserver',
      'Paste its access token',
    ]);
    expect(steps[0].closest('ol')).not.toBeNull();
    // A provider may keep a free-form note after the steps.
    expect(
      screen.getByText('Self-hosted homeservers must be reachable from this instance.'),
    ).toBeDefined();
  });

  it('renders the portal and docs links, opening in a new tab', async () => {
    await renderForm('slack');

    const portal = (await screen.findByText('Slack API')).closest('a') as HTMLAnchorElement;
    expect(portal.getAttribute('href')).toBe('https://api.slack.com/apps');
    expect(portal.getAttribute('target')).toBe('_blank');
    expect(portal.getAttribute('rel')).toContain('noopener');

    const docs = screen.getByText('Docs').closest('a') as HTMLAnchorElement;
    expect(docs.getAttribute('href')).toBe('https://docs.example/comms/slack');
    expect(docs.getAttribute('target')).toBe('_blank');
  });
});

describe('CommsConfigForm webhook pre-mint', () => {
  it('mints a placeholder webhook exactly once for a webhook provider in setup mode', async () => {
    await renderForm('slack');

    await waitFor(() =>
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/config/slack/webhook',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // The mint refetches the config so the copy field can show the URL.
    await waitFor(() => expect(configLoadCount()).toBeGreaterThan(1));
    const mintCalls = mockFetchFn.mock.calls.filter(
      ([u]) => u === '/settings/comms/config/slack/webhook',
    );
    expect(mintCalls).toHaveLength(1);
  });

  it('does not mint for poll-inbound providers (matrix) or configured ones (telegram)', async () => {
    await renderForm('matrix');
    await screen.findByText('Homeserver URL');
    await renderForm('telegram');
    await screen.findByPlaceholderText(/saved — leave blank/);

    expect(
      mockFetchFn.mock.calls.some(([u]) => typeof u === 'string' && /\/webhook$/.test(u)),
    ).toBe(false);
  });
});

describe('CommsConfigForm platform connect', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue({ closed: false } as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('oauth connect fetches the consent URL and opens the popup', async () => {
    await renderForm('slack');

    fireEvent.click(await screen.findByText('Connect with Slack'));

    await waitFor(() =>
      expect(mockFetchFn).toHaveBeenCalledWith('/settings/comms/oauth/slack/url'),
    );
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://slack.example/oauth',
        'postmill-comms-oauth',
        'width=640,height=720,popup',
      ),
    );
  });

  it('closes and refetches when the popup posts postmill:comms-connected', async () => {
    const onClose = vi.fn();
    await renderForm('slack', onClose);
    fireEvent.click(await screen.findByText('Connect with Slack'));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    // Let the webhook pre-mint refetch settle before the baseline.
    await waitFor(() => expect(configLoadCount()).toBeGreaterThan(1));
    const baseline = configLoadCount();

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'postmill:comms-connected', provider: 'slack' },
        origin: window.location.origin,
      }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockToasterShow).toHaveBeenCalledWith('Provider connected', 'success');
    expect(configLoadCount()).toBeGreaterThan(baseline);
  });

  it('ignores connected messages from a foreign origin', async () => {
    const onClose = vi.fn();
    await renderForm('slack', onClose);
    fireEvent.click(await screen.findByText('Connect with Slack'));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'postmill:comms-connected', provider: 'slack' },
        origin: 'https://evil.example',
      }),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('env connect POSTs platform-connect and refetches on success', async () => {
    await renderForm('discord');

    fireEvent.click(await screen.findByText('Use the Postmill app'));

    await waitFor(() =>
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/settings/comms/platform-connect/discord',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Provider connected', 'success'),
    );
  });

  it('env connect shows the backend error verbatim inline on failure', async () => {
    mockFetchFn.mockImplementation((url: unknown, init?: unknown) => {
      if (typeof url === 'string' && url === '/settings/comms/config' && !init) {
        return Promise.resolve({ ok: true, json: async () => configData });
      }
      if (url === '/settings/comms/platform-connect/discord') {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ message: 'Discord bot token rejected by the gateway' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    await renderForm('discord');

    fireEvent.click(await screen.findByText('Use the Postmill app'));

    expect(
      await screen.findByText('Discord bot token rejected by the gateway'),
    ).toBeDefined();
    expect(mockToasterShow).not.toHaveBeenCalledWith('Provider connected', 'success');
  });
});
