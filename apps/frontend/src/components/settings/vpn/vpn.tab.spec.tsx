import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VpnTab } from './vpn.tab';

const mockFetch = vi.fn();
const mockMutate = vi.fn();
const mockOpenModal = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}));

vi.mock('@postmill-ai/frontend/components/shared/provider-icon', () => ({
  __esModule: true,
  default: () => <span data-testid="provider-icon">icon</span>,
}));

vi.mock('swr', () => ({
  default: vi.fn(),
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

vi.mock('@postmill-ai/frontend/components/settings/shared/use-provider-catalog', () => ({
  useProviderCatalog: () => ({ data: [] }),
}));

// Capture the config-modal open (no ModalManager in this suite).
vi.mock('@postmill-ai/frontend/components/layout/new-modal', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModals: () => ({
    openModal: mockOpenModal,
    closeAll: vi.fn(),
    closeById: vi.fn(),
  }),
}));

import useSWR from 'swr';

// The kit panel consumes the descriptor-mapped `{ rows: ProviderRow[] }` shape.
const mockRows = {
  rows: [
    {
      id: 'nordvpn',
      identifier: 'nordvpn',
      name: 'NordVPN',
      isConfigured: false,
      isPrimary: false,
      enabled: false,
      capabilities: ['wireguard', 'openvpn', 'ikev2', 'socks5', 'multiHop', 'killSwitch'],
      meta: {
        identifier: 'nordvpn',
        name: 'NordVPN',
        credentialFields: [{ key: 'serviceCredentials', label: 'Service Credentials', type: 'password', required: true }],
      },
    },
    {
      id: 'mullvad',
      identifier: 'mullvad',
      name: 'Mullvad VPN',
      isConfigured: true,
      isPrimary: false,
      enabled: true,
      capabilities: ['wireguard', 'openvpn', 'socks5', 'multiHop', 'killSwitch'],
      meta: {
        identifier: 'mullvad',
        name: 'Mullvad VPN',
        credentialFields: [{ key: 'accountNumber', label: 'Account Number', type: 'password', required: true }],
      },
    },
  ],
};

describe('VpnTab', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRows),
    });
    vi.mocked(useSWR).mockReturnValue({
      data: mockRows,
      isLoading: false,
      error: null,
      mutate: mockMutate,
    } as any);
  });

  it('renders provider list with capability chips', async () => {
    render(<VpnTab />);

    await waitFor(() => {
      expect(screen.getByText('NordVPN')).toBeDefined();
      expect(screen.getByText('Mullvad VPN')).toBeDefined();
    });

    expect(screen.getAllByText('WireGuard').length).toBe(2);
    expect(screen.getAllByText('OpenVPN').length).toBe(2);
  });

  it('renders no Edit/Configure links — row click opens the config modal', async () => {
    render(<VpnTab />);

    await waitFor(() => {
      expect(screen.getByText('NordVPN')).toBeDefined();
      expect(screen.getByText('Mullvad VPN')).toBeDefined();
    });
    expect(screen.queryByText('Configure')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();

    // Row click (on the row, not a nested button) opens the modal titled
    // `<icon> <name> Setup|Edit` via the shared ProviderModalTitle.
    fireEvent.click(screen.getAllByTestId('provider-icon')[0]);
    expect(mockOpenModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({
          props: expect.objectContaining({ action: expect.stringMatching(/setup|edit/) }),
        }),
      }),
    );
  });
});
