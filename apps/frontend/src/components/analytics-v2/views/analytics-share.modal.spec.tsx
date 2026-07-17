import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

// ChannelAvatar pulls in provider-icon assets; stub to keep rows lean.
vi.mock('../kit/channel-avatar', () => ({
  ChannelAvatar: ({ name }: { name: string }) => (
    <div data-testid="channel-avatar">{name}</div>
  ),
}));

const mockToasterShow = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

const mockUseIntegrationList = vi.fn();
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => mockUseIntegrationList(),
}));

vi.mock('@gitroom/frontend/components/launches/calendar.context', () => ({}));

const mockSave = vi.fn();
const mockDisable = vi.fn();
const mockUseAnalyticsShare = vi.fn();
vi.mock('../hooks/useAnalyticsShare', () => ({
  useAnalyticsShare: () => mockUseAnalyticsShare(),
}));

import { AnalyticsShareModal } from './analytics-share.modal';

const INTEGRATIONS = [
  { id: 'i1', name: 'Insta', identifier: 'instagram', picture: null },
  { id: 'i2', name: 'My X', identifier: 'x', picture: null },
];

function stub(over: any = {}) {
  mockUseAnalyticsShare.mockReturnValue({
    data: { token: null, enabled: false, config: {} },
    isLoading: false,
    error: undefined,
    save: mockSave,
    disable: mockDisable,
    ...over,
  });
}

describe('AnalyticsShareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIntegrationList.mockReturnValue({ data: INTEGRATIONS });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
  });

  it('renders the loading skeleton while the config loads', () => {
    stub({ isLoading: true });
    const { container } = render(<AnalyticsShareModal />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the description, range preset options and the channel list', () => {
    stub();
    render(<AnalyticsShareModal />);
    expect(screen.getByText(/Create a read-only public link/i)).toBeTruthy();
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    expect(screen.getByText('Last 30 days')).toBeTruthy();
    expect(screen.getByText('Last 90 days')).toBeTruthy();
    // one avatar per integration
    expect(screen.getAllByTestId('channel-avatar')).toHaveLength(2);
    expect(screen.getAllByText('Insta').length).toBeGreaterThan(0);
  });

  it('defaults the range select to last_30d and updates on change', () => {
    stub();
    const { container } = render(<AnalyticsShareModal />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('last_30d');
    fireEvent.change(select, { target: { value: 'last_7d' } });
    expect(select.value).toBe('last_7d');
  });

  it('honours the loaded config range preset', () => {
    stub({ data: { token: null, enabled: false, config: { rangePreset: 'last_90d' } } });
    const { container } = render(<AnalyticsShareModal />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('last_90d');
  });

  it('toggles a channel checkbox on and off', () => {
    stub();
    const { container } = render(<AnalyticsShareModal />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const first = checkboxes[0] as HTMLInputElement;
    expect(first.checked).toBe(false);
    fireEvent.click(first);
    expect(first.checked).toBe(true);
    fireEvent.click(first);
    expect(first.checked).toBe(false);
  });

  it('pre-checks channels already in the loaded config', () => {
    stub({
      data: { token: 't', enabled: true, config: { integrations: ['i2'] } },
    });
    const { container } = render(<AnalyticsShareModal />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it('shows "Create link" and no disable button when sharing is off', () => {
    stub();
    render(<AnalyticsShareModal />);
    expect(screen.getByText('Create link')).toBeTruthy();
    expect(screen.queryByText('Disable link')).toBeFalsy();
    expect(screen.queryByText('Copy')).toBeFalsy();
  });

  it('creates a link and toasts success (mint, not rotate)', async () => {
    stub();
    mockSave.mockResolvedValue({});
    render(<AnalyticsShareModal />);
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    // no channels selected -> integrations undefined, range default
    expect(mockSave).toHaveBeenCalledWith({ integrations: undefined, rangePreset: 'last_30d' });
    expect(mockToasterShow).toHaveBeenCalledWith('Public share link created', 'success');
  });

  it('passes the selected channels to save', async () => {
    stub();
    mockSave.mockResolvedValue({});
    const { container } = render(<AnalyticsShareModal />);
    fireEvent.click(container.querySelectorAll('input[type="checkbox"]')[0]);
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalledWith({ integrations: ['i1'], rangePreset: 'last_30d' });
  });

  it('toasts a warning when save fails', async () => {
    stub();
    mockSave.mockRejectedValue(new Error('nope'));
    render(<AnalyticsShareModal />);
    fireEvent.click(screen.getByText('Create link'));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to update share link', 'warning')
    );
  });

  it('shows the public URL + copy/rotate/disable when enabled, and rotates', async () => {
    stub({ data: { token: 'tok123', enabled: true, config: {} } });
    mockSave.mockResolvedValue({});
    render(<AnalyticsShareModal />);
    expect(screen.getByText(/\/share\/analytics\/tok123$/)).toBeTruthy();
    expect(screen.getByText('Save / rotate link')).toBeTruthy();
    fireEvent.click(screen.getByText('Save / rotate link'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockToasterShow).toHaveBeenCalledWith('Share link rotated', 'success');
  });

  it('copies the public URL to the clipboard', async () => {
    stub({ data: { token: 'tok123', enabled: true, config: {} } });
    render(<AnalyticsShareModal />);
    fireEvent.click(screen.getByText('Copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/share/analytics/tok123')
    );
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Link copied to clipboard', 'success')
    );
  });

  it('falls back to a "copy manually" warning when the Clipboard API is unavailable (F6)', async () => {
    // navigator.clipboard is undefined on non-HTTPS origins.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    stub({ data: { token: 'tok123', enabled: true, config: {} } });
    render(<AnalyticsShareModal />);
    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith(
        'Could not copy automatically — select the link and copy it manually',
        'warning'
      )
    );
  });

  it('renders a quiet admins-only notice when the share config GET fails (F6)', () => {
    stub({ data: undefined, error: new Error('403') });
    render(<AnalyticsShareModal />);
    expect(screen.getByText(/Sharing is managed by org admins/i)).toBeTruthy();
    // No broken form underneath.
    expect(screen.queryByText('Create link')).toBeFalsy();
    expect(screen.queryByText('Date range')).toBeFalsy();
  });

  it('disables the link and toasts success', async () => {
    stub({ data: { token: 'tok123', enabled: true, config: {} } });
    mockDisable.mockResolvedValue(undefined);
    render(<AnalyticsShareModal />);
    fireEvent.click(screen.getByText('Disable link'));
    await waitFor(() => expect(mockDisable).toHaveBeenCalled());
    expect(mockToasterShow).toHaveBeenCalledWith('Public share link removed', 'success');
  });

  it('toasts a warning when disable fails', async () => {
    stub({ data: { token: 'tok123', enabled: true, config: {} } });
    mockDisable.mockRejectedValue(new Error('boom'));
    render(<AnalyticsShareModal />);
    fireEvent.click(screen.getByText('Disable link'));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to remove share link', 'warning')
    );
  });

  it('tolerates a non-array integrations payload', () => {
    mockUseIntegrationList.mockReturnValue({ data: undefined });
    stub();
    render(<AnalyticsShareModal />);
    expect(screen.queryByTestId('channel-avatar')).toBeFalsy();
  });
});
