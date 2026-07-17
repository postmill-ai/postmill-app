import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTile } from './stat-tile';
import { KPI } from '../utils';

vi.mock('../hooks/useCountUp', () => ({
  useCountUp: (target: number) => target,
}));

// RichTile now calls useT() for the clickable tile's aria-label (2.7). Mock the
// translation client like the other analytics-v2 specs so it resolves fallbacks.
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

vi.mock('chart.js/auto', () => ({
  default: class {
    destroy() {}
  },
}));

const baseKpi: KPI = {
  metric: 'impressions',
  label: 'Impressions',
  format: 'number',
  total: 12345,
  previousTotal: 10000,
  percentageChange: 23.45,
  sparkline: [],
};

describe('StatTile (rich / kpi variant)', () => {
  it('renders metric label', () => {
    render(<StatTile kpi={baseKpi} />);
    expect(screen.getByText('Impressions')).toBeTruthy();
  });

  it('renders formatted number value', () => {
    render(<StatTile kpi={baseKpi} />);
    expect(screen.getByText('12,345')).toBeTruthy();
  });

  it('renders positive percentage change', () => {
    render(<StatTile kpi={baseKpi} />);
    expect(
      screen.getByText((content) => content.startsWith('23.4') && content.includes('%'))
    ).toBeTruthy();
  });

  it('renders negative percentage change', () => {
    render(<StatTile kpi={{ ...baseKpi, percentageChange: -15.3 }} />);
    expect(screen.getByText('15.3%')).toBeTruthy();
  });

  it('hides trend block when percentage change is zero', () => {
    render(<StatTile kpi={{ ...baseKpi, percentageChange: 0 }} />);
    expect(screen.queryByText('0.0%')).toBeFalsy();
  });

  it('renders percent format correctly', () => {
    render(<StatTile kpi={{ ...baseKpi, format: 'percent', total: 45.67 }} />);
    expect(screen.getByText('45.7%')).toBeTruthy();
  });

  it('renders currency format correctly', () => {
    render(<StatTile kpi={{ ...baseKpi, format: 'currency', total: 5000 }} />);
    expect(screen.getByText('$5,000')).toBeTruthy();
  });

  it('renders sparkline canvas when data has multiple points', () => {
    const { container } = render(
      <StatTile
        kpi={{
          ...baseKpi,
          sparkline: [
            { date: '2024-01-01', value: 10 },
            { date: '2024-01-02', value: 20 },
          ],
        }}
      />
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('does not render sparkline for single data point', () => {
    const { container } = render(
      <StatTile kpi={{ ...baseKpi, sparkline: [{ date: '2024-01-01', value: 10 }] }} />
    );
    expect(container.querySelector('canvas')).toBeFalsy();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<StatTile kpi={baseKpi} onClick={onClick} />);
    (
      screen.getByText('Impressions').closest('[class*="cursor-pointer"]') as HTMLElement
    )!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('StatTile (plain / label-value variant)', () => {
  it('renders label and value', () => {
    render(<StatTile label="Total Clicks" value="150" />);
    expect(screen.getByText('Total Clicks')).toBeTruthy();
    expect(screen.getByText('150')).toBeTruthy();
  });

  it('renders an accent bar when accent is passed', () => {
    const { container } = render(
      <StatTile label="Channels" value="4" accent="var(--chart-3, #1d9bf0)" />
    );
    expect(container.querySelectorAll('.pointer-events-none').length).toBe(2);
  });
});
