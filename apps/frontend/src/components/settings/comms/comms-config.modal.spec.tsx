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
  return Promise.resolve({
    ok: true,
    json: async () => ({ connectCode: 'ABCD2345', expiresAt: '2026-08-31T00:00:00Z', ok: true }),
    text: async () => '',
  });
};

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
    await screen.findByText('Signing Secret');
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
