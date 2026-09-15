import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { commsConfigFixture as configData } from './comms.test-fixture';
import {
  COMMS_CONNECTED_STORAGE_KEY,
  COMMS_FULLPAGE_STORAGE_KEY,
} from './use-comms-config';

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

  it('signals, then toasts/refetches/scrubs on a full-page ?connected landing (close no-ops)', async () => {
    // jsdom windows never close, so window.close() no-ops and the 400ms
    // fallback runs — exactly what a real full-page landing does.
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    window.history.replaceState({}, '', '/settings/comms?connected=slack');
    try {
      const { CommsTab } = await import('./comms.tab');
      render(<CommsTab />, { wrapper });

      // The handshake signal is written immediately, before any fallback.
      await waitFor(() => expect(closeSpy).toHaveBeenCalled());
      const signal = JSON.parse(
        window.localStorage.getItem(COMMS_CONNECTED_STORAGE_KEY) || '{}',
      );
      expect(signal.provider).toBe('slack');
      expect(signal.ts).toBeGreaterThan(0);

      await waitFor(() =>
        expect(mockToasterShow).toHaveBeenCalledWith('Provider connected', 'success'),
      );
      expect(window.location.search).not.toContain('connected');
    } finally {
      window.localStorage.removeItem(COMMS_CONNECTED_STORAGE_KEY);
      window.history.replaceState({}, '', '/');
      closeSpy.mockRestore();
    }
  });

  it('posts postmill:comms-connected to the opener when it survives', async () => {
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
      // The localStorage signal is written too — it is the COOP-proof path.
      const signal = JSON.parse(
        window.localStorage.getItem(COMMS_CONNECTED_STORAGE_KEY) || '{}',
      );
      expect(signal.provider).toBe('slack');
      expect(closeSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'opener', { value: null, writable: true });
      window.localStorage.removeItem(COMMS_CONNECTED_STORAGE_KEY);
      window.history.replaceState({}, '', '/');
      closeSpy.mockRestore();
    }
  });

  it('never closes the tab that marked itself as the popup-blocked full-page fallback', async () => {
    // A script-opened main tab (target=_blank from an email/Slack link) IS
    // closable, so the "close, fall back if still here" heuristic would
    // discard the user's whole app tab. The fallback path marks the tab
    // before navigating; the landing honours the mark and lands directly.
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    window.sessionStorage.setItem(COMMS_FULLPAGE_STORAGE_KEY, '1');
    window.history.replaceState({}, '', '/settings/comms?connected=slack');
    try {
      const { CommsTab } = await import('./comms.tab');
      render(<CommsTab />, { wrapper });
      await waitFor(() =>
        expect(mockToasterShow).toHaveBeenCalledWith('Provider connected', 'success'),
      );
      expect(closeSpy).not.toHaveBeenCalled();
      expect(window.location.search).not.toContain('connected');
      // Mark is single-use; no popup signal is written for a full-page landing.
      expect(window.sessionStorage.getItem(COMMS_FULLPAGE_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem(COMMS_CONNECTED_STORAGE_KEY)).toBeNull();
    } finally {
      window.sessionStorage.removeItem(COMMS_FULLPAGE_STORAGE_KEY);
      window.history.replaceState({}, '', '/');
      closeSpy.mockRestore();
    }
  });

  it('signals and closes with a severed opener and wiped window.name (the Slack case, any provider)', async () => {
    // Verified in Chrome: Slack's consent pages sever window.opener via COOP
    // AND reset window.name — but window.close() still works. No popup
    // detection: signal unconditionally, attempt close unconditionally.
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    Object.defineProperty(window, 'opener', { value: null, writable: true });
    window.history.replaceState({}, '', '/settings/comms?connected=matrix');
    try {
      const { CommsTab } = await import('./comms.tab');
      render(<CommsTab />, { wrapper });

      await waitFor(() => expect(closeSpy).toHaveBeenCalled());
      const signal = JSON.parse(
        window.localStorage.getItem(COMMS_CONNECTED_STORAGE_KEY) || '{}',
      );
      expect(signal.provider).toBe('matrix');
      expect(signal.ts).toBeGreaterThan(0);
    } finally {
      window.localStorage.removeItem(COMMS_CONNECTED_STORAGE_KEY);
      window.history.replaceState({}, '', '/');
      closeSpy.mockRestore();
    }
  });

  it('signals callback errors and toasts them on a full-page landing', async () => {
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    window.history.replaceState({}, '', '/settings/comms?error=access_denied');
    try {
      const { CommsTab } = await import('./comms.tab');
      render(<CommsTab />, { wrapper });

      await waitFor(() => expect(closeSpy).toHaveBeenCalled());
      const signal = JSON.parse(
        window.localStorage.getItem(COMMS_CONNECTED_STORAGE_KEY) || '{}',
      );
      expect(signal.error).toBe('access_denied');

      await waitFor(() =>
        expect(mockToasterShow).toHaveBeenCalledWith('access_denied', 'warning'),
      );
      expect(mockToasterShow).not.toHaveBeenCalledWith('Provider connected', 'success');
      expect(window.location.search).not.toContain('error');
    } finally {
      window.localStorage.removeItem(COMMS_CONNECTED_STORAGE_KEY);
      window.history.replaceState({}, '', '/');
      closeSpy.mockRestore();
    }
  });
});
