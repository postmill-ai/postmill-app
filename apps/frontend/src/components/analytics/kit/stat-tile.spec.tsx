import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTile } from './stat-tile';
import { KPI } from '../utils';

vi.mock('../hooks/useCountUp', () => ({
  useCountUp: (target: number) => target,
}));

// RichTile now calls useT() for the clickable tile's aria-label (2.7). Mock the
// translation client like the other analytics specs so it resolves fallbacks.
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
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

  // Tiles are as narrow as ~95px on the dashboard, so the value is compacted and
  // the exact figure moves to the title attribute.
  it('compacts the value and keeps the exact figure on hover', () => {
    render(<StatTile kpi={baseKpi} />);
    const value = screen.getByText('12.3K');
    expect(value).toBeTruthy();
    expect(value.getAttribute('title')).toBe('12,345');
  });

  it('compacts a value that would otherwise be truncated', () => {
    render(<StatTile kpi={{ ...baseKpi, total: 1_234_567 }} />);
    const value = screen.getByText('1.2M');
    expect(value.getAttribute('title')).toBe('1,234,567');
  });

  it('leaves small numbers alone', () => {
    render(<StatTile kpi={{ ...baseKpi, total: 842 }} />);
    expect(screen.getByText('842')).toBeTruthy();
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
    const value = screen.getByText('$5.0K');
    expect(value.getAttribute('title')).toBe('$5,000');
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

describe('StatTile value sizing', () => {
  // A ~120px dashboard tile fits about four characters at 32px; longer compacted
  // figures used to be truncated to an unreadable "259…".
  // `mobile:text-[22px]` is always present, so compare only the unprefixed token.
  const sizeOf = (total: number, format: KPI['format'] = 'number') => {
    const { container } = render(
      <StatTile kpi={{ ...baseKpi, total, format, percentageChange: 0 }} />
    );
    const el = container.querySelector('[title]') as HTMLElement;
    return el.className
      .split(/\s+/)
      .filter((c) => !c.includes(':') && c.startsWith('text-['))
      .join(' ');
  };

  it('keeps short figures at full size', () => {
    expect(sizeOf(84)).toBe('text-[32px]');
  });

  it('steps down so a compacted figure fits', () => {
    expect(sizeOf(259506)).toBe('text-[26px]');
    expect(screen.getAllByText('259.5K').length).toBeGreaterThan(0);
  });

  it('steps down again for the longest figures', () => {
    // "$259.5K" — currency adds the character that pushes it over.
    expect(sizeOf(259506, 'currency')).toBe('text-[22px]');
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
