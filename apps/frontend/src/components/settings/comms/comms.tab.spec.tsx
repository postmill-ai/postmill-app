import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { commsConfigFixture as configData } from './comms.test-fixture';

const mockFetchFn = vi.fn();
const mockToasterShow = vi.fn();
const mockT = vi.fn(
  (_key: string, fallback?: string, vars?: Record<string, string>) =>
    (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (m, k) => vars?.[k] ?? m)
);
const mockOpenModal = vi.fn();
const mockHasPermission = vi.fn(() => true);

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
  useModals: () => ({ openModal: mockOpenModal }),
  useDecisionModal: () => ({ open: mockDecisionOpen }),
}));

vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFn.mockImplementation(defaultFetchImpl);
  mockHasPermission.mockReturnValue(true);
});

describe('CommsTab', () => {
  it('lists only configured providers, with webhook and linked-member badges', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    expect(await screen.findByText('Telegram')).toBeDefined();
    expect(screen.getByText('Discord')).toBeDefined();
    // Slack is not configured — it belongs in the picker, not the list.
    expect(screen.queryByText('Slack')).toBeNull();
    // Webhook-registration warning surfaces on the row.
    expect(screen.getByText('Webhook not registered')).toBeDefined();
    // Linked members show like channels' "Connected as".
    expect(screen.getByText(/Linked: Sam/)).toBeDefined();
  });

  it('opens the edit modal when a row is clicked', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    fireEvent.click(await screen.findByText('Telegram'));

    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledTimes(1));
    // Header is <icon> <name> Edit as a ProviderModalTitle element.
    expect(mockOpenModal.mock.calls[0][0].title.props).toMatchObject({
      identifier: 'telegram',
      name: 'Telegram',
      action: 'edit',
    });

    // The modal renders the provider's credential form and its member links.
    const modal = mockOpenModal.mock.calls[0][0].children(() => undefined);
    render(modal, { wrapper });
    expect(await screen.findByPlaceholderText(/saved — leave blank/)).toBeDefined();
    expect(await screen.findByText('Maya')).toBeDefined();
    expect(screen.getByText('Pending')).toBeDefined();
  });

  it('opens the picker with unconfigured providers only, then the configure modal', async () => {
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: /Add Comms Channel/ }));

    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledTimes(1));
    const picker = mockOpenModal.mock.calls[0][0].children(() => undefined);
    // Scope to the picker's own container — the tab's rows are still mounted
    // (render()'s queries are bound to document.body by default).
    const pickerView = render(picker, { wrapper });
    const withinPicker = within(pickerView.container);

    const slackButton = await withinPicker.findByText('Slack');
    // Already-configured providers are not offered again.
    expect(withinPicker.queryByText('Telegram')).toBeNull();
    expect(withinPicker.queryByText('Discord')).toBeNull();
    // The comms capability matrix renders as badges (Slack: webhook + threads)
    // — scoped to the Slack row (matrix also carries Threads).
    const slackRow = within(slackButton.closest('button') as HTMLElement);
    expect(slackRow.getByText('Webhook')).toBeDefined();
    expect(slackRow.getByText('Threads')).toBeDefined();
    // Pinned-version pill, like the channels picker/list rows.
    expect(slackRow.getByText('v1')).toBeDefined();

    fireEvent.click(slackButton);
    await waitFor(() => expect(mockOpenModal).toHaveBeenCalledTimes(2));
    expect(mockOpenModal.mock.calls[1][0].title.props).toMatchObject({
      identifier: 'slack',
      name: 'Slack',
      action: 'setup',
    });
  });

  it('hides the add button without the settings update permission', async () => {
    mockHasPermission.mockReturnValue(false);
    const { CommsTab } = await import('./comms.tab');
    render(<CommsTab />, { wrapper });

    expect(await screen.findByText('Telegram')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Add Comms Channel/ })).toBeNull();
  });

  it('toasts, refetches and scrubs the URL on a full-page ?connected landing', async () => {
    window.history.replaceState({}, '', '/settings/comms?connected=slack');
    try {
      const { CommsTab } = await import('./comms.tab');
      render(<CommsTab />, { wrapper });

      await waitFor(() =>
        expect(mockToasterShow).toHaveBeenCalledWith('Provider connected', 'success'),
      );
      expect(window.location.search).not.toContain('connected');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('posts postmill:comms-connected to the opener and closes inside the connect popup', async () => {
    const postMessage = vi.fn();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    Object.defineProperty(window, 'opener', { value: { postMessage }, writable: true });
    window.history.replaceState({}, '', '/settings/comms?connected=slack');
    try {
      const { CommsTab } = await import('./comms.tab');
      render(<CommsTab />, { wrapper });

      await waitFor(() => expect(postMessage).toHaveBeenCalled());
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'postmill:comms-connected', provider: 'slack' },
        window.location.origin,
      );
      expect(closeSpy).toHaveBeenCalled();
      // The popup branch must not toast into a window that is closing.
      expect(mockToasterShow).not.toHaveBeenCalledWith('Provider connected', 'success');
    } finally {
      Object.defineProperty(window, 'opener', { value: null, writable: true });
      window.history.replaceState({}, '', '/');
      closeSpy.mockRestore();
    }
  });
});
