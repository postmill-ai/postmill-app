import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayDetailPanel } from './day.detail.panel';
import { DayDetailResponse } from '../utils';

vi.mock('../hooks/useDayDrill', () => ({
  useDayDrill: () => ({ data: undefined as DayDetailResponse | undefined }),
}));

const fullData: DayDetailResponse = {
  date: '2024-06-15',
  metric: 'Impressions',
  value: 5000,
  byChannel: [
    { integrationId: 'i1', name: 'Twitter', identifier: '@twitter', picture: '/tw.png', value: 3000 },
    { integrationId: 'i2', name: 'LinkedIn', identifier: 'linkedin', picture: '/li.png', value: 2000 },
  ],
  posts: [
    {
      postId: 'p1',
      content: 'Post content here',
      integration: { id: 'i1', name: 'Twitter', identifier: '@twitter', picture: '/tw.png' },
      publishedAt: '2024-06-15',
      metrics: { impressions: 1000 },
    },
    {
      postId: 'p2',
      content: 'Another post',
      integration: { id: 'i2', name: 'LinkedIn', identifier: 'linkedin', picture: '/li.png' },
      publishedAt: '2024-06-15',
      metrics: { impressions: 500 },
    },
  ],
};

const baseProps = {
  open: true,
  onClose: vi.fn(),
};

describe('DayDetailPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<DayDetailPanel {...baseProps} open={false} data={fullData} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no data (loading state)', () => {
    const { container } = render(<DayDetailPanel {...baseProps} data={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when no data (empty state)', () => {
    const { container } = render(<DayDetailPanel {...baseProps} data={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders date, metric, total value', () => {
    render(<DayDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('Impressions')).toBeTruthy();
    expect(screen.getByText('2024-06-15')).toBeTruthy();
    expect(screen.getByText('5,000')).toBeTruthy();
  });

  it('shows byChannel breakdown', () => {
    render(<DayDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('By Channel')).toBeTruthy();
    expect(screen.getByText('3,000')).toBeTruthy();
    expect(screen.getByText('2,000')).toBeTruthy();
  });

  it('hides byChannel section when empty', () => {
    const data: DayDetailResponse = { ...fullData, byChannel: [] };
    render(<DayDetailPanel {...baseProps} data={data} />);
    expect(screen.queryByText('By Channel')).toBeNull();
  });

  it('shows posts list with post content and integration', () => {
    render(<DayDetailPanel {...baseProps} data={fullData} />);
    expect(screen.getByText('Posts on this day')).toBeTruthy();
    expect(screen.getByText('Post content here')).toBeTruthy();
    expect(screen.getByText('Another post')).toBeTruthy();
  });

  it('hides posts section when empty', () => {
    const data: DayDetailResponse = { ...fullData, posts: [] };
    render(<DayDetailPanel {...baseProps} data={data} />);
    expect(screen.queryByText('Posts on this day')).toBeNull();
  });
});
