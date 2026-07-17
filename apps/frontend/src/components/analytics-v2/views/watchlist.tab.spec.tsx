import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

// LineChart is chart.js-backed; stub so the growth overlay branch renders.
vi.mock('../charts/line.chart', () => ({
  LineChart: () => <div data-testid="line-chart" />,
}));

const mockFetch = vi.fn();
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const mockToasterShow = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

const mockUseSWR = vi.fn();
const mockMutate = vi.fn();
vi.mock('swr', () => ({
  default: (...args: any[]) => mockUseSWR(...args),
  mutate: (...args: any[]) => mockMutate(...args),
}));

const mockUseWatchlistSeries = vi.fn();
vi.mock('../hooks/useWatchlistSeries', () => ({
  useWatchlistSeries: (...args: any[]) => mockUseWatchlistSeries(...args),
}));

import { WatchlistTab } from './watchlist.tab';

const account = (over: any = {}) => ({
  id: 'acc-1',
  provider: 'x',
  handle: '@rival',
  displayName: 'Rival Co',
  enabled: true,
  lastError: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  metrics: [],
  ...over,
});

function stubAccounts(over: any = {}) {
  mockUseSWR.mockReturnValue({ data: undefined, error: undefined, ...over });
}

function stubSeries(over: any = {}) {
  mockUseWatchlistSeries.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
    ...over,
  });
}

describe('WatchlistTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    stubSeries();
  });

  it('renders the loading skeleton while accounts are undefined', () => {
    stubAccounts();
    const { container } = render(<WatchlistTab />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the error state on load failure', () => {
    stubAccounts({ error: new Error('boom') });
    render(<WatchlistTab />);
    expect(screen.getByText(/Failed to load watchlist/i)).toBeTruthy();
  });

  it('renders the empty message when there are no accounts', () => {
    stubAccounts({ data: [] });
    render(<WatchlistTab />);
    expect(screen.getByText(/No watched accounts yet/i)).toBeTruthy();
  });

  it('disables Add until a handle is entered, then keeps enabled after typing', () => {
    stubAccounts({ data: [] });
    render(<WatchlistTab />);
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('@username'), {
      target: { value: '@newone' },
    });
    expect(add.disabled).toBe(false);
  });

  it('posts a new account (with provider + trimmed display name) and revalidates', async () => {
    stubAccounts({ data: [] });
    render(<WatchlistTab />);

    fireEvent.change(screen.getByDisplayValue('X/Twitter'), {
      target: { value: 'tiktok' },
    });
    fireEvent.change(screen.getByPlaceholderText('@username'), {
      target: { value: '  @rival  ' },
    });
    // display name is the third text input (the one without a placeholder)
    const inputs = document.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[1], { target: { value: '  Rival  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/analytics/v2/watchlist');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      provider: 'tiktok',
      handle: '@rival',
      displayName: 'Rival',
    });
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith('/analytics/v2/watchlist')
    );
  });

  it('keeps the form state and warns instead of clearing on a failed add (F5)', async () => {
    stubAccounts({ data: [] });
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    render(<WatchlistTab />);

    const handleInput = screen.getByPlaceholderText('@username') as HTMLInputElement;
    fireEvent.change(handleInput, { target: { value: '@rival' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to add account', 'warning')
    );
    // Form is NOT cleared, so the user can retry.
    expect(handleInput.value).toBe('@rival');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('warns and skips revalidation when a toggle fails (F5)', async () => {
    stubAccounts({ data: [account({ enabled: true })] });
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    render(<WatchlistTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to update account', 'warning')
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('warns and skips revalidation when a remove fails (F5)', async () => {
    stubAccounts({ data: [account()] });
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    render(<WatchlistTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to remove account', 'warning')
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('omits displayName when the field is blank', async () => {
    stubAccounts({ data: [] });
    render(<WatchlistTab />);
    fireEvent.change(screen.getByPlaceholderText('@username'), {
      target: { value: '@rival' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.displayName).toBeUndefined();
  });

  it('renders account rows with display name, error badge and latest metric', () => {
    stubAccounts({
      data: [
        account({
          lastError: 'rate limited',
          metrics: [
            { id: 'm1', metric: 'followers', value: 999, capturedAt: 'x' },
          ],
        }),
      ],
    });
    render(<WatchlistTab />);
    expect(screen.getByText('Rival Co')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText(/followers: 999/)).toBeTruthy();
  });

  it('falls back to the handle when there is no display name', () => {
    stubAccounts({ data: [account({ displayName: null })] });
    render(<WatchlistTab />);
    expect(screen.getByText('@rival')).toBeTruthy();
  });

  it('toggles enabled state via PUT and revalidates', async () => {
    stubAccounts({ data: [account({ enabled: true })] });
    render(<WatchlistTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/analytics/v2/watchlist/acc-1');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ enabled: false });
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith('/analytics/v2/watchlist')
    );
  });

  it('shows a Disabled label for a disabled account', () => {
    stubAccounts({ data: [account({ enabled: false })] });
    render(<WatchlistTab />);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeTruthy();
  });

  it('removes an account via DELETE and revalidates', async () => {
    stubAccounts({ data: [account()] });
    render(<WatchlistTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/analytics/v2/watchlist/acc-1');
    expect(opts.method).toBe('DELETE');
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith('/analytics/v2/watchlist')
    );
  });

  it('opens the growth overlay on click and toggles it off on a second click', () => {
    stubAccounts({ data: [account()] });
    stubSeries({
      data: {
        own: [{ date: '2026-06-01', value: 1 }],
        watched: [{ date: '2026-06-01', value: 2 }],
      },
    });
    render(<WatchlistTab />);
    const growth = screen.getByRole('button', { name: 'Growth' });
    expect(growth.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(growth);
    expect(growth.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('line-chart')).toBeTruthy();
    expect(screen.getByText(/Followers — you vs Rival Co/)).toBeTruthy();

    fireEvent.click(growth);
    expect(growth.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('shows the growth loading skeleton while the series loads', () => {
    stubAccounts({ data: [account()] });
    stubSeries({ isLoading: true });
    const { container } = render(<WatchlistTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Growth' }));
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });

  it('shows the growth empty state when there is no series data', () => {
    stubAccounts({ data: [account()] });
    stubSeries({ data: { own: [], watched: [] } });
    render(<WatchlistTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Growth' }));
    expect(screen.getByText(/No growth data yet/i)).toBeTruthy();
    expect(screen.queryByTestId('line-chart')).toBeNull();
  });
});
