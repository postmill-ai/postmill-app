import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

import { DerivedMetricTiles, DerivedMetricInline } from './derived-metrics';

describe('DerivedMetricTiles (6.2)', () => {
  it('renders nothing when derived is missing', () => {
    const { container } = render(<DerivedMetricTiles derived={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when both values are null (no misleading 0)', () => {
    const { container } = render(
      <DerivedMetricTiles derived={{ engagementRate: null, reachPerFollower: null }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('hides only the null tile', () => {
    render(<DerivedMetricTiles derived={{ engagementRate: 0.0325, reachPerFollower: null }} />);
    expect(screen.getByText('Engagement rate')).toBeTruthy();
    expect(screen.getByText('3.25%')).toBeTruthy();
    expect(screen.queryByText('Reach / follower')).toBeNull();
  });

  it('formats reach-per-follower with a ×', () => {
    render(<DerivedMetricTiles derived={{ engagementRate: null, reachPerFollower: 1.4 }} />);
    expect(screen.getByText('1.40×')).toBeTruthy();
  });
});

describe('DerivedMetricInline (6.2)', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<DerivedMetricInline derived={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the present metrics compactly', () => {
    render(<DerivedMetricInline derived={{ engagementRate: 0.05, reachPerFollower: 2 }} />);
    expect(screen.getByText(/ER/)).toBeTruthy();
    expect(screen.getByText(/R\/F/)).toBeTruthy();
  });
});
