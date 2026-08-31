import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// Capture every chart.js instantiation so the specs can assert on the config
// (labels/datasets) and on how often the chart is torn down + recreated.
const instances: { config: any }[] = [];
vi.mock('chart.js/auto', () => ({
  default: class {
    config: any;
    constructor(_el: unknown, config: any) {
      this.config = config;
      instances.push(this);
    }
    destroy() {}
  },
}));

import { LineChart } from './line.chart';

const gradient = { addColorStop: vi.fn() };

describe('LineChart', () => {
  beforeEach(() => {
    instances.length = 0;
    // jsdom has no canvas — stub the 2d context the component needs.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      createLinearGradient: vi.fn(() => gradient),
    })) as any;
  });

  const lastConfig = () => instances[instances.length - 1].config;

  it('uses the main series dates as labels when there is no comparison', () => {
    render(
      <LineChart
        series={[
          { date: '2026-06-01', value: 1 },
          { date: '2026-06-02', value: 2 },
        ]}
      />
    );
    const config = lastConfig();
    expect(config.data.labels).toEqual(['2026-06-01', '2026-06-02']);
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0].data).toEqual([1, 2]);
  });

  it('aligns both series over the sorted union of dates when they differ (F1)', () => {
    render(
      <LineChart
        series={[
          { date: '2026-06-02', value: 20 },
          { date: '2026-06-04', value: 40 },
        ]}
        comparisonSeries={[
          { date: '2026-06-01', value: 1 },
          { date: '2026-06-02', value: 2 },
          { date: '2026-06-03', value: 3 },
        ]}
      />
    );
    const config = lastConfig();
    // Labels are the sorted union, not just the main series' dates.
    expect(config.data.labels).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
    const [comparison, main] = config.data.datasets;
    expect(comparison.label).toBe('Previous period');
    expect(comparison.data).toEqual([1, 2, 3, null]);
    expect(main.label).toBe('Current period');
    expect(main.data).toEqual([null, 20, null, 40]);
    // Chart.js default (spanGaps unset = false) breaks lines at nulls instead
    // of drawing misleading bridges.
    expect(main.spanGaps).toBeUndefined();
    expect(config.options.spanGaps).toBeUndefined();
  });

  it('renders the watched line when the own series is empty (watchlist case)', () => {
    render(
      <LineChart
        series={[]}
        comparisonSeries={[
          { date: '2026-06-01', value: 100 },
          { date: '2026-06-02', value: 110 },
        ]}
      />
    );
    const config = lastConfig();
    expect(config.data.labels).toEqual(['2026-06-01', '2026-06-02']);
    expect(config.data.datasets[0].data).toEqual([100, 110]);
    // The empty own series maps to all-null over the union.
    expect(config.data.datasets[1].data).toEqual([null, null]);
  });

  it('does not recreate the chart when only onPointClick changes (F2)', () => {
    const series = [{ date: '2026-06-01', value: 1 }];
    const { rerender } = render(
      <LineChart series={series} onPointClick={() => {}} />
    );
    expect(instances).toHaveLength(1);
    // A new inline handler (what callers pass) must not tear the chart down.
    rerender(<LineChart series={series} onPointClick={() => {}} />);
    expect(instances).toHaveLength(1);
  });

  it('invokes the latest onPointClick handler with the clicked label', () => {
    const series = [{ date: '2026-06-01', value: 1 }];
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <LineChart series={series} onPointClick={first} />
    );
    rerender(<LineChart series={series} onPointClick={second} />);
    lastConfig().options.onClick(undefined, [{ index: 0 }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('2026-06-01');
  });
});
