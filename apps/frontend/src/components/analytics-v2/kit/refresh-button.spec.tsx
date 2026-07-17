import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const mockShow = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockShow }),
}));

const mockMutate = vi.fn().mockResolvedValue(undefined);
vi.mock('swr', () => ({ mutate: (...a: any[]) => mockMutate(...a) }));

const mockRefresh = vi.fn();
vi.mock('../hooks/useChannelRefresh', () => {
  class ChannelRefreshError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { useChannelRefresh: () => mockRefresh, ChannelRefreshError };
});

import { RefreshButton } from './refresh-button';
import { ChannelRefreshError } from '../hooks/useChannelRefresh';

describe('RefreshButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate.mockResolvedValue(undefined);
  });

  it('renders an accessible refresh button', () => {
    render(<RefreshButton integrationId="i1" />);
    expect(screen.getByLabelText('Refresh analytics')).toBeTruthy();
  });

  it('applies a passed-through className', () => {
    render(<RefreshButton integrationId="i1" className="extra-class" />);
    expect(screen.getByLabelText('Refresh analytics').className).toContain('extra-class');
  });

  it('refreshes, revalidates analytics keys and toasts success', async () => {
    mockRefresh.mockResolvedValueOnce(undefined);
    render(<RefreshButton integrationId="i1" />);
    fireEvent.click(screen.getByLabelText('Refresh analytics'));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith('Channel refreshed', 'success')
    );
    expect(mockRefresh).toHaveBeenCalledWith('i1');

    // mutate is called with a predicate matching only /analytics/v2/ string keys.
    const predicate = mockMutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(predicate('/analytics/v2/overview')).toBe(true);
    expect(predicate('/other')).toBe(false);
    expect(predicate(123)).toBe(false);
  });

  it('shows the throttled message on a 429 error', async () => {
    mockRefresh.mockRejectedValueOnce(new ChannelRefreshError('nope', 429));
    render(<RefreshButton integrationId="i1" />);
    fireEvent.click(screen.getByLabelText('Refresh analytics'));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        'Too many refreshes — try again later.',
        'warning'
      )
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows the generic failure message on a non-429 ChannelRefreshError', async () => {
    mockRefresh.mockRejectedValueOnce(new ChannelRefreshError('down', 502));
    render(<RefreshButton integrationId="i1" />);
    fireEvent.click(screen.getByLabelText('Refresh analytics'));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        'Could not refresh this channel right now.',
        'warning'
      )
    );
  });

  it('shows the generic failure message on a non-ChannelRefreshError throw', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('boom'));
    render(<RefreshButton integrationId="i1" />);
    fireEvent.click(screen.getByLabelText('Refresh analytics'));

    await waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(
        'Could not refresh this channel right now.',
        'warning'
      )
    );
  });

  it('ignores a second click while a refresh is in flight (busy guard)', async () => {
    let resolve!: () => void;
    mockRefresh.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      })
    );
    render(<RefreshButton integrationId="i1" />);
    const btn = screen.getByLabelText('Refresh analytics');

    fireEvent.click(btn);
    // Button is disabled while busy.
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(btn);

    resolve();
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
