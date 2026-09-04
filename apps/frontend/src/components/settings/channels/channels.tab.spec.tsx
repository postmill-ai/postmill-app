import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetch = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const mockToasterShow = vi.fn();
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const mockDecisionOpen = vi.fn();
const mockOpenModal = vi.fn();
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: mockOpenModal, closeAll: vi.fn() }),
  useDecisionModal: () => ({ open: mockDecisionOpen }),
}));

vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    isResolved: true,
    isSuperAdmin: true,
  }),
}));

const mockConnectChannel = vi.fn();
vi.mock(
  '@postmill-ai/frontend/components/launches/add.provider.component',
  () => ({
    useAddProvider: () => mockConnectChannel,
  })
);

vi.mock(
  '@postmill-ai/frontend/components/settings/shared/provider-list-shell',
  () => ({
    default: () => null,
  })
);

vi.mock(
  '@postmill-ai/frontend/components/settings/shared/use-provider-catalog',
  () => ({
    useProviderCatalog: () => ({ data: [] }),
    latestActiveVersion: () => undefined,
  })
);

vi.mock('./channel-edit.modal', () => ({
  ChannelConfigForm: () => null,
}));

vi.mock('@postmill-ai/frontend/components/shared/platform-icon', () => ({
  PlatformIcon: ({ identifier }: { identifier: string }) => (
    <span data-testid="platform-icon" data-identifier={identifier} />
  ),
}));

import { ChannelsTab } from './channels.tab';

let mockIntegrations: any[] = [];

const defaultFetchImpl = (url: string, _init?: any) => {
  if (url === '/integrations/list') {
    return Promise.resolve({
      ok: true,
      json: async () => ({ integrations: mockIntegrations }),
    });
  }
  if (typeof url === 'string' && url.startsWith('/channels/config')) {
    return Promise.resolve({ ok: true, json: async () => [] });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

describe('ChannelsTab connected channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecisionOpen.mockResolvedValue(true);
    mockFetch.mockImplementation(defaultFetchImpl);
    mockIntegrations = [
      {
        id: 'ch-1',
        name: 'My IG',
        identifier: 'instagramstandalone',
        display: '@myig',
        disabled: false,
        inBetweenSteps: false,
      },
      {
        id: 'ch-2',
        name: 'FB Page',
        identifier: 'facebook',
        display: '',
        disabled: true,
        inBetweenSteps: false,
      },
      {
        id: 'ch-3',
        name: 'Stuck FB',
        identifier: 'facebook',
        display: '',
        disabled: false,
        inBetweenSteps: true,
      },
    ];
  });

  it('renders connected-channel rows from /integrations/list with status pills', async () => {
    render(<ChannelsTab />, { wrapper });

    expect(await screen.findByText('My IG')).toBeTruthy();
    expect(screen.getByText('@myig')).toBeTruthy();
    expect(screen.getByText('FB Page')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByText('Setup incomplete')).toBeTruthy();
    // Incomplete rows offer Finish setup (re-runs the connect flow).
    const finish = screen.getByText('Finish setup');
    fireEvent.click(finish);
    expect(mockConnectChannel).toHaveBeenCalled();
  });

  it('disable confirms and posts to /integrations/disable with the channel id', async () => {
    render(<ChannelsTab />, { wrapper });

    fireEvent.click(await screen.findByText('Disable'));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/integrations/disable', {
        method: 'POST',
        body: JSON.stringify({ id: 'ch-1' }),
      })
    );
    expect(mockDecisionOpen).toHaveBeenCalled();
  });

  it('delete issues DELETE /integrations and toasts the 406 posts warning', async () => {
    mockFetch.mockImplementation((url: string, init?: any) => {
      if (url === '/integrations' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 406 });
      }
      return defaultFetchImpl(url, init);
    });

    render(<ChannelsTab />, { wrapper });

    fireEvent.click((await screen.findAllByText('Delete'))[0]);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/integrations', {
        method: 'DELETE',
        body: JSON.stringify({ id: 'ch-1' }),
      })
    );
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith(
        'You have to delete all the posts associated with this channel before deleting it',
        'warning'
      )
    );
  });
});
