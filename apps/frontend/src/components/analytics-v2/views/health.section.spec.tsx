import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

// ChannelAvatar pulls in provider-icon assets; stub to keep the row render lean.
vi.mock('../kit/channel-avatar', () => ({
  ChannelAvatar: ({ name }: { name: string }) => <div data-testid="channel-avatar">{name}</div>,
}));

const mockUseHealth = vi.fn();
vi.mock('../hooks/useHealth', () => ({
  useHealth: () => mockUseHealth(),
}));

import { HealthSection } from './health.section';

function stub(over: any = {}) {
  mockUseHealth.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
    ...over,
  });
}

describe('HealthSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the loading skeleton', () => {
    stub({ isLoading: true });
    const { container } = render(<HealthSection />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the error state with retry', () => {
    const mutate = vi.fn();
    stub({ error: new Error('boom'), mutate });
    render(<HealthSection />);
    expect(screen.getByText(/Failed to load channel health/i)).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByText(/Try again/i));
    expect(mutate).toHaveBeenCalled();
  });

  it('renders the empty state when no channels', () => {
    stub({ data: [] });
    render(<HealthSection />);
    expect(screen.getByText(/No channels connected/i)).toBeTruthy();
  });

  it('renders supported, stale, unsupported and no-snapshot rows', () => {
    stub({
      data: [
        {
          integrationId: 'a',
          name: 'Insta',
          identifier: 'instagram',
          picture: null,
          supportsAnalytics: true,
          lastSnapshotDate: '2026-07-01',
          coverage: 0.86,
          stale: true,
        },
        {
          integrationId: 'b',
          name: 'My Discord',
          identifier: 'discord',
          picture: null,
          supportsAnalytics: false,
          lastSnapshotDate: null,
          coverage: 0,
          stale: false,
        },
        {
          integrationId: 'c',
          name: 'Fresh X',
          identifier: 'x',
          picture: null,
          supportsAnalytics: true,
          lastSnapshotDate: null,
          coverage: 0,
          stale: false,
        },
      ],
    });
    render(<HealthSection />);

    // supported + stale row: stale badge, last-snapshot line, coverage %
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText(/Last snapshot 2026-07-01/i)).toBeTruthy();
    expect(screen.getByText('86%')).toBeTruthy();

    // unsupported row: labeled, never zeros
    expect(
      screen.getByText(/Analytics not supported by Discord/i)
    ).toBeTruthy();

    // supported but no snapshot yet
    expect(screen.getByText(/No snapshot collected yet/i)).toBeTruthy();
  });
});
