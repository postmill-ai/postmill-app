import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelsTab } from './channels.tab';
import { OverviewResponse } from '../utils';

vi.mock('../hooks/useChannelDetail', () => ({
  useChannelDetail: () => ({ data: undefined as any }),
}));

const baseProps = {
  loading: false,
  from: '2024-01-01',
  to: '2024-01-07',
  compare: false,
  integrations: ['i1', 'i2'],
  channels: [
    { integrationId: 'i1', name: 'Twitter', identifier: '@twitter', picture: '/tw.png' },
    { integrationId: 'i2', name: 'LinkedIn', identifier: 'linkedin', picture: '/li.png' },
  ],
  onSelectChannel: vi.fn(),
};

const sampleData: OverviewResponse = {
  range: { from: '2024-01-01', to: '2024-01-07' },
  kpis: [],
  series: {},
  byChannel: [
    {
      integrationId: 'i1',
      name: 'Twitter',
      identifier: '@twitter',
      picture: '/tw.png',
      kpis: [
        {
          metric: 'impressions',
          label: 'Impressions',
          format: 'number',
          total: 30000,
          previousTotal: 20000,
          percentageChange: 50,
        },
      ],
    },
    {
      integrationId: 'i2',
      name: 'LinkedIn',
      identifier: 'linkedin',
      picture: '/li.png',
      kpis: [],
    },
  ],
  breakdown: { byPlatform: [] },
};

describe('ChannelsTab', () => {
  it('renders loading skeletons', () => {
    const { container } = render(
      <ChannelsTab {...baseProps} loading={true} />
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders error state', () => {
    render(
      <ChannelsTab
        {...baseProps}
        loading={false}
        error={new Error('fail')}
      />
    );
    expect(screen.getByText('Failed to load channel data')).toBeTruthy();
  });

  it('renders empty state when no channel data', () => {
    render(
      <ChannelsTab
        {...baseProps}
        loading={false}
        data={{
          range: { from: '2024-01-01', to: '2024-01-07' },
          kpis: [],
          series: {},
          byChannel: [],
          breakdown: { byPlatform: [] },
        }}
      />
    );
    expect(screen.getByText('No channel data available')).toBeTruthy();
  });

  it('renders channel cards with names and identifiers', () => {
    render(<ChannelsTab {...baseProps} loading={false} data={sampleData} />);
    expect(screen.getByText('Twitter')).toBeTruthy();
    expect(screen.getByText('@twitter')).toBeTruthy();
    expect(screen.getByText('LinkedIn')).toBeTruthy();
    expect(screen.getByText('linkedin')).toBeTruthy();
  });

  it('renders KPI values for channels that have them', () => {
    render(<ChannelsTab {...baseProps} loading={false} data={sampleData} />);
    expect(screen.getByText('30,000')).toBeTruthy();
    expect(screen.getByText('+50.0%')).toBeTruthy();
  });

  it('calls onSelectChannel when a channel card is clicked', () => {
    const onSelectChannel = vi.fn();
    render(
      <ChannelsTab
        {...baseProps}
        loading={false}
        data={sampleData}
        onSelectChannel={onSelectChannel}
      />
    );
    screen.getByText('Twitter').click();
    expect(onSelectChannel).toHaveBeenCalledWith('i1');
  });
});
