import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

// Avoid pulling the shared ProviderIcon (brand SVG registry) into the test.
vi.mock('../kit/channel-avatar', () => ({
  ChannelAvatar: ({ name }: { name?: string }) => (
    <div data-testid="channel-avatar">{name}</div>
  ),
}));

const mockDismiss = vi.fn();
const mockMutate = vi.fn();
const mockUseAnomalies = vi.fn();
vi.mock('../hooks/useAnomalies', () => ({
  useAnomalies: () => mockUseAnomalies(),
}));

import { AlertsSection, AnomalyOverviewStrip } from './alerts.section';
import type { AnomalyRow } from '../hooks/useAnomalies';

const row = (over: Partial<AnomalyRow> = {}): AnomalyRow => ({
  id: 'a1',
  integrationId: 'int-1',
  metric: 'impressions',
  direction: 'spike',
  value: 12000,
  baseline: 5000,
  deviation: 1.4,
  topPostId: null,
  notifiedAt: null,
  dismissedAt: null,
  createdAt: '2024-01-15T00:00:00.000Z',
  integration: {
    id: 'int-1',
    name: 'Twitter',
    providerIdentifier: 'x',
    picture: null,
  },
  ...over,
});

function stub(over: Partial<ReturnType<typeof mockUseAnomalies>> = {}) {
  mockUseAnomalies.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: undefined,
    dismiss: mockDismiss,
    mutate: mockMutate,
    ...over,
  });
}

describe('AlertsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when there are no alerts', () => {
    stub({ data: [] });
    render(<AlertsSection />);
    expect(screen.getByText('No alerts')).toBeTruthy();
  });

  it('renders the error state with a retry', () => {
    stub({ error: new Error('boom') });
    render(<AlertsSection />);
    expect(screen.getByText('Failed to load alerts')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('renders a list of alerts with channel, metric label and direction', () => {
    stub({
      data: [
        row(),
        row({ id: 'a2', direction: 'drop', metric: 'likes', deviation: -0.6 }),
      ],
    });
    render(<AlertsSection />);
    expect(screen.getAllByTestId('channel-avatar').length).toBe(2);
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('Likes')).toBeTruthy();
    expect(screen.getByText('Spike')).toBeTruthy();
    expect(screen.getByText('Drop')).toBeTruthy();
    // deviation rendered as a signed percentage
    expect(screen.getByText('+140%')).toBeTruthy();
    expect(screen.getByText('-60%')).toBeTruthy();
  });

  it('calls dismiss(id) when the dismiss button is clicked', () => {
    stub({ data: [row()] });
    render(<AlertsSection />);
    fireEvent.click(screen.getByRole('button', { name: /Dismiss alert/i }));
    expect(mockDismiss).toHaveBeenCalledWith('a1');
  });

  it('shows a root-cause post link only when topPostId is present', () => {
    stub({ data: [row({ topPostId: 'post-9' })] });
    render(<AlertsSection />);
    const link = screen.getByText('View top post') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('focusPost=post-9');
  });

  it('deep-links the metric view consistently with the bell notification', () => {
    stub({ data: [row()] });
    render(<AlertsSection />);
    const link = screen.getByText('View metric') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      '/analytics?tab=insights&integrations=int-1&metric=impressions'
    );
  });

  it('badges rule-fired alerts (7.3) and exposes a Manage rules button', () => {
    stub({ data: [row({ ruleId: 'rule-1' }), row({ id: 'a2' })] });
    render(<AlertsSection />);
    // Exactly one rule-fired row is badged.
    expect(screen.getAllByText('Rule').length).toBe(1);
    expect(screen.getByRole('button', { name: /Manage alert rules/i })).toBeTruthy();
  });
});

describe('AnomalyOverviewStrip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a strip deep-linking to Insights → Alerts when anomalies exist', () => {
    stub({ data: [row(), row({ id: 'a2' })] });
    const { container } = render(<AnomalyOverviewStrip />);
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(
      '/analytics?tab=insights&section=alerts'
    );
  });

  it('renders nothing when there are no undismissed anomalies', () => {
    stub({ data: [] });
    const { container } = render(<AnomalyOverviewStrip />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('ignores already-dismissed rows in the count', () => {
    stub({ data: [row({ dismissedAt: '2024-01-16T00:00:00.000Z' })] });
    const { container } = render(<AnomalyOverviewStrip />);
    expect(container.querySelector('a')).toBeNull();
  });
});
