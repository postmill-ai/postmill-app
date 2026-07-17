import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

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

import { PieChart } from './pie.chart';

describe('PieChart', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  const lastConfig = () => instances[instances.length - 1].config;

  it('renders slices sorted by value', () => {
    render(
      <PieChart
        data={[
          { label: 'a', value: 1 },
          { label: 'b', value: 5 },
        ]}
      />
    );
    const config = lastConfig();
    expect(config.data.labels).toEqual(['b', 'a']);
    expect(config.data.datasets[0].data).toEqual([5, 1]);
  });

  it('folds slices beyond maxSlices into "Other"', () => {
    render(
      <PieChart
        data={[
          { label: 'a', value: 5 },
          { label: 'b', value: 4 },
          { label: 'c', value: 3 },
          { label: 'd', value: 2 },
        ]}
        maxSlices={3}
      />
    );
    const config = lastConfig();
    expect(config.data.labels).toEqual(['a', 'b', 'Other']);
    expect(config.data.datasets[0].data).toEqual([5, 4, 5]);
  });

  it('does not recreate the chart on a parent re-render with the same data (F2)', () => {
    const data = [{ label: 'a', value: 1 }];
    const { rerender } = render(<PieChart data={data} onSliceClick={() => {}} />);
    expect(instances).toHaveLength(1);
    rerender(<PieChart data={data} onSliceClick={() => {}} />);
    expect(instances).toHaveLength(1);
  });

  it('invokes the latest onSliceClick handler without recreating the chart', () => {
    const data = [{ label: 'a', value: 1 }];
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<PieChart data={data} onSliceClick={first} />);
    rerender(<PieChart data={data} onSliceClick={second} />);
    expect(instances).toHaveLength(1);
    lastConfig().options.onClick(undefined, [{ index: 0 }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('a');
  });
});
