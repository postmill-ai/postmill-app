import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

function renderForm(platformConfigured: boolean) {
  return render(
    <ChannelConfigForm
      identifier="instagram-standalone"
      providerName="Instagram (Standalone)"
      platformConfigured={platformConfigured}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

describe('ChannelConfigForm enable guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('allows enabling without a Client ID when a platform app is configured', () => {
    renderForm(true);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(mockToast).not.toHaveBeenCalledWith(CREDENTIALS_WARNING, 'warning');
  });

  it('blocks enabling without a Client ID when no platform app is configured', () => {
    renderForm(false);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockToast).toHaveBeenCalledWith(CREDENTIALS_WARNING, 'warning');
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('saves an enabled credential set without clientId when a platform app is configured', async () => {
    renderForm(true);
    fireEvent.change(
      screen.getByPlaceholderText('e.g. Marketing LinkedIn'),
      { target: { value: 'My IG set' } }
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/channels/config');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      identifier: 'instagram-standalone',
      name: 'My IG set',
      enabled: true,
    });
    expect(body.clientId).toBeUndefined();
    expect(mockToast).toHaveBeenCalledWith('Channel saved', 'success');
  });
});
