import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetchFn = vi.fn();
const mockToasterShow = vi.fn();
const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);

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

const configData = {
  providers: [
    {
      identifier: 'telegram',
      name: 'Telegram',
      enabled: true,
      isConfigured: true,
      credentialFields: [
        { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
      ],
      credentialsSet: { botToken: true },
      webhookUrl: 'https://backend.example/webhooks/comms/telegram/tok',
      webhookRegistered: true,
    },
    {
      identifier: 'slack',
      name: 'Slack',
      enabled: false,
      isConfigured: false,
      credentialFields: [
        { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
        { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true },
      ],
      credentialsSet: { botToken: false, signingSecret: false },
    },
  ],
  links: [
    {
      id: 'link-1',
      identifier: 'telegram',
      userId: 'user-1',
      userEmail: 'maya@solstice.demo',
      userName: 'Maya',
      status: 'pending',
      agentChatEnabled: true,
      categories: { post_failed: true },
    },
  ],
  members: [
    { id: 'user-1', email: 'maya@solstice.demo', name: 'Maya', roleKey: 'owner', disabled: false },
    { id: 'user-2', email: 'sam@solstice.demo', name: 'Sam', roleKey: 'member', disabled: false },
  ],
};

const defaultFetchImpl = (url: any, init?: any) => {
  if (typeof url === 'string' && url === '/settings/comms/config' && !init) {
    return Promise.resolve({ ok: true, json: async () => configData });
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({ connectCode: 'ABCD2345', expiresAt: '2026-08-31T00:00:00Z' }),
    text: async () => '',
  });
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFn.mockImplementation(defaultFetchImpl);
});

describe('CommsTab', () => {
  it('renders provider cards and the link table', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    expect(await screen.findByText('Telegram')).toBeDefined();
    expect(screen.getByText('Slack')).toBeDefined();
    expect(screen.getByText(/maya@solstice.demo|Maya/)).toBeDefined();
    expect(screen.getByText('Pending')).toBeDefined();
  });

  it('saves provider credentials via PUT', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    fireEvent.click((await screen.findAllByText('Configure'))[0]);
    const input = screen.getByPlaceholderText(/saved — leave blank/);
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
  });

  it('creates a link with member + provider + categories and reveals the one-time code', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    fireEvent.click(await screen.findByTestId('comms-add-link'));
    fireEvent.click(screen.getByTestId('member-picker-toggle'));
    fireEvent.click(screen.getByTestId('member-option-user-2'));
    fireEvent.change(screen.getByLabelText('Comms app'), {
      target: { value: 'telegram' },
    });
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
    expect(await screen.findByTestId('comms-connect-code')).toBeDefined();
    expect(screen.getByTestId('comms-connect-code').textContent).toBe('ABCD2345');
  });

  it('warns instead of posting when member or provider is missing', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

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
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    fireEvent.click(await screen.findByLabelText('Agent chat'));
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
});
