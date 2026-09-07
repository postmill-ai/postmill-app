import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

// Shape of the openModal params we capture (no ModalManager in this suite).
type OpenModalParams = {
  title: { props: { identifier: string; name: string; action: string } };
  children: (close: () => void) => ReactNode;
};

const mockFetchFn = vi.fn();
const mockToasterShow = vi.fn();
const mockDecisionOpen = vi.fn();
const mockOpenModal = vi.fn();
const mockT = vi.fn((_key: string, fallback?: string, opts?: Record<string, any>) => {
  if (!fallback) return _key;
  if (opts?.count !== undefined) return fallback.replace('{{count}}', String(opts.count));
  return fallback;
});

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

// The delete flow now confirms through the bespoke decision modal
// (useDecisionModal) instead of window.confirm. Keep the rest of new-modal real
// and only stub the decision hook + useModals (the config form opens through
// openModal — no ModalManager is mounted in this suite, so we capture the call
// and render `children` manually where the form itself is under test).
vi.mock('@postmill-ai/frontend/components/layout/new-modal', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  useDecisionModal: () => ({ open: mockDecisionOpen }),
  useModals: () => ({
    openModal: mockOpenModal,
    closeAll: vi.fn(),
    closeById: vi.fn(),
  }),
}));

vi.mock('@postmill-ai/frontend/components/shared/provider-icon', () => ({
  default: ({ identifier, name }: { identifier: string; name: string }) => (
    <span data-testid="provider-icon" data-identifier={identifier}>{name}</span>
  ),
}));

vi.mock('@postmill-ai/frontend/components/settings/shared/use-provider-catalog', () => ({
  useProviderCatalog: () => ({ data: [] }),
  selectableVersions: () => [],
  latestActiveVersion: () => undefined,
}));

// The migrated tab loads its config through `descriptor.load(fetch)` (one GET to
// `/settings/shortlinks/config`) rather than the legacy hook, so the providers
// envelope is served via the mocked fetch below.
const defaultProviders = [
  {
    identifier: 'bitly',
    name: 'Bitly',
    capabilities: { create: true, statistics: true, customDomain: true, expand: false, bulkStatistics: false },
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    authType: 'apiKey',
    isActive: false,
    isConfigured: false,
    customDomain: '',
    configs: [],
  },
  {
    identifier: 'tinyurl',
    name: 'TinyURL',
    capabilities: { create: true, statistics: false, customDomain: false, expand: false, bulkStatistics: false },
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    authType: 'apiKey',
    isActive: false,
    isConfigured: true,
    customDomain: '',
    configs: [{ id: 'cfg-1', name: '', accountFingerprint: '', isActive: false, customDomain: '', createdAt: '', updatedAt: '' }],
  },
  {
    identifier: 'rebrandly',
    name: 'Rebrandly',
    capabilities: { create: true, statistics: true, customDomain: true, expand: false, bulkStatistics: false },
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    authType: 'apiKey',
    isActive: true,
    isConfigured: true,
    customDomain: '',
    configs: [{ id: 'cfg-2', name: '', accountFingerprint: '', isActive: true, customDomain: '', createdAt: '', updatedAt: '' }],
  },
  {
    identifier: 'readonly-provider',
    name: 'ReadOnly',
    capabilities: { create: false, statistics: false, customDomain: false, expand: false, bulkStatistics: false },
    credentialFields: [],
    authType: 'apiKey',
    isActive: false,
    isConfigured: false,
    customDomain: '',
    configs: [],
  },
];

let mockConfigData: any = { active: null, providers: defaultProviders };

const defaultFetchImpl = (url: any) => {
  if (typeof url === 'string') {
    if (url.endsWith('/settings/shortlinks/config')) {
      return Promise.resolve({ ok: true, json: async () => mockConfigData });
    }
    if (url.includes('/providers/catalog')) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
  }
  return Promise.resolve({ ok: true, text: async () => '' });
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    value: { search: '', href: 'https://example.com/settings?tab=shortlinks', origin: 'https://example.com' },
    writable: true,
  });
  mockConfigData = { active: null, providers: [...defaultProviders] };
  mockFetchFn.mockImplementation(defaultFetchImpl);
});

describe('ShortlinksTab', () => {
  describe('Provider List', () => {
    it('renders all providers', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      expect((await screen.findAllByText('Bitly')).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('TinyURL').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Rebrandly').length).toBeGreaterThanOrEqual(1);
    });

    it('renders no Edit/Configure links — the whole row opens the config modal', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      expect((await screen.findAllByText('Bitly')).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Configure')).toBeNull();
      expect(screen.queryByText('Edit')).toBeNull();
    });

    it('opens the config modal with the shared title on row click (setup vs edit)', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      expect((await screen.findAllByText('Bitly')).length).toBeGreaterThanOrEqual(1);

      // Unconfigured provider → "Setup".
      fireEvent.click(document.querySelector('[data-identifier="bitly"]')!);
      expect(mockOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.objectContaining({
            props: expect.objectContaining({
              identifier: 'bitly',
              name: 'Bitly',
              action: 'setup',
            }),
          }),
        }),
      );

      // Configured provider → "Edit".
      fireEvent.click(document.querySelector('[data-identifier="tinyurl"]')!);
      expect(mockOpenModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.objectContaining({
            props: expect.objectContaining({
              identifier: 'tinyurl',
              name: 'TinyURL',
              action: 'edit',
            }),
          }),
        }),
      );
    });

    it('shows Make Primary button only for configured but inactive providers', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      expect(await screen.findByText('Make Primary')).toBeDefined();
    });

    it('filters providers by search', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      const searchInput = await screen.findByPlaceholderText('Search providers...');
      fireEvent.change(searchInput, { target: { value: 'tiny' } });

      await waitFor(() => {
        expect(screen.getAllByText('TinyURL').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Bitly')).toBeNull();
      });
    });
  });

  describe('Capability Chips', () => {
    it('renders Stats chip for providers with statistics', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      const statsChips = await screen.findAllByText('Stats');
      expect(statsChips.length).toBeGreaterThan(0);
    });

    it('renders Custom domain chip for providers with customDomain', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      const customDomainChips = await screen.findAllByText('Custom domain');
      expect(customDomainChips.length).toBeGreaterThan(0);
    });
  });

  describe('Delete Provider', () => {
    // Remove lives in the config modal footer — open it through the row click
    // (openModal is captured, so we render its children manually).
    const openEditForm = async (identifier: string) => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });
      await screen.findAllByText('Rebrandly');

      fireEvent.click(document.querySelector(`[data-identifier="${identifier}"]`)!);
      const call = mockOpenModal.mock.calls.find(
        ([params]: [OpenModalParams]) => params.title.props.identifier === identifier,
      );
      expect(call).toBeDefined();
      const children = call![0].children;
      render(<>{children(vi.fn())}</>, { wrapper });
      return screen.findByText('Remove');
    };

    it('shows confirm dialog before deleting', async () => {
      // User dismisses the decision modal → no delete request.
      mockDecisionOpen.mockResolvedValue(false);

      const removeButton = await openEditForm('rebrandly');
      fireEvent.click(removeButton);

      await waitFor(() => {
        expect(mockDecisionOpen).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'Are you sure you want to remove this configuration?',
          }),
        );
      });
      expect(mockFetchFn).not.toHaveBeenCalledWith('/settings/shortlinks/config/rebrandly', {
        method: 'DELETE',
      });
    });

    it('calls delete endpoint by identifier after confirm', async () => {
      // User approves the decision modal → delete request fires.
      mockDecisionOpen.mockResolvedValue(true);

      const removeButton = await openEditForm('rebrandly');
      fireEvent.click(removeButton);

      await waitFor(() => {
        expect(mockFetchFn).toHaveBeenCalledWith('/settings/shortlinks/config/rebrandly', {
          method: 'DELETE',
        });
      });

      await waitFor(() => {
        expect(mockToasterShow).toHaveBeenCalledWith('Configuration deleted', 'success');
      });
    });
  });

  describe('Error State', () => {
    it('renders error message on fetch failure', async () => {
      mockFetchFn.mockImplementation((url: any) =>
        typeof url === 'string' && url.includes('/providers/catalog')
          ? Promise.resolve({ ok: true, json: async () => [] })
          : Promise.resolve({ ok: false }),
      );

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      expect(await screen.findByText('Failed to load settings')).toBeDefined();
      expect(screen.getByText('Try again')).toBeDefined();
    });
  });

  describe('Provider Form Modal', () => {
    it('renders the config form inside the modal on row click', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      await screen.findAllByText('Bitly');
      fireEvent.click(document.querySelector('[data-identifier="bitly"]')!);

      const call = mockOpenModal.mock.calls.find(
        ([params]: [OpenModalParams]) => params.title.props.identifier === 'bitly',
      );
      expect(call).toBeDefined();
      const children = call![0].children;
      render(<>{children(vi.fn())}</>, { wrapper });

      // The modal frame supplies the header/close; the form footer is
      // Cancel | Test Connection | Save (Remove only when configured).
      await screen.findByText('Cancel');
      expect(screen.getByText('Test Connection')).toBeDefined();
      expect(screen.getByText('Save')).toBeDefined();
      expect(screen.queryByText('Remove')).toBeNull();
    });
  });

  describe('OAuth Callback', () => {
    beforeEach(() => {
      sessionStorage.setItem('oauth_shortlink_provider', 'bitly');
      window.location.search = '?code=abc123&state=xyz789';
      window.history.replaceState = vi.fn();
    });

    afterEach(() => {
      sessionStorage.removeItem('oauth_shortlink_provider');
    });

    it('sends state in the callback POST body', async () => {
      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      await waitFor(() => {
        expect(mockFetchFn).toHaveBeenCalledWith('/settings/shortlinks/config/bitly/oauth/callback', {
          method: 'POST',
          body: JSON.stringify({ code: 'abc123', state: 'xyz789', redirectUri: 'https://example.com/settings?tab=shortlinks' }),
        });
      });
    });

    it('shows warning toast and skips the callback when storedIdentifier is missing', async () => {
      sessionStorage.removeItem('oauth_shortlink_provider');

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab />, { wrapper });

      await waitFor(() => {
        expect(mockToasterShow).toHaveBeenCalledWith('Could not resume the connection — please retry.', 'warning');
      });

      expect(mockFetchFn).not.toHaveBeenCalledWith(
        '/settings/shortlinks/config/bitly/oauth/callback',
        expect.anything(),
      );
    });
  });
});
