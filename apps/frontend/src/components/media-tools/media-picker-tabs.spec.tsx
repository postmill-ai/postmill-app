import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, d: string) => d,
}));

/**
 * The picker's tab bar. `MediaSelectorModal` itself pulls in SWR, the file
 * manager and five stock browsers, so these cover the piece that actually
 * changed — the inline section label OverflowTabs now renders.
 */

const inline = (label: string) =>
  screen
    .getAllByText(label)
    .filter((el) => el.closest('[data-overflow-slot]') || el.dataset.slot === 'tabs-section');

describe('inline section labels', () => {
  const items = [
    { key: 'My Files', label: 'My Files' },
    { key: 'Stock Audio', label: 'Audio', section: 'Stock' },
    { key: 'Stock Photos', label: 'Photos', section: 'Stock' },
    { key: 'Stock Videos', label: 'Videos', section: 'Stock' },
  ];

  it('says "Stock:" once for a run of stock tabs', () => {
    render(<OverflowTabs items={items} activeKey="My Files" showSectionLabels />);
    const labels = screen.getAllByText('Stock:');
    expect(labels).toHaveLength(1);
  });

  it('places the label before the first item of its group', () => {
    const { container } = render(<OverflowTabs items={items} activeKey="My Files" showSectionLabels />);
    const track = container.querySelector('[data-slot="tabs-track"]')!;
    const text = [...track.querySelectorAll('span,button,a')]
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    const stockAt = text.indexOf('Stock:');
    const audioAt = text.indexOf('Audio');
    expect(stockAt).toBeGreaterThan(-1);
    expect(stockAt).toBeLessThan(audioAt);
  });

  it('renders no label when nothing is grouped', () => {
    render(
      <OverflowTabs
        items={[
          { key: 'a', label: 'One' },
          { key: 'b', label: 'Two' },
        ]}
        activeKey="a"
        showSectionLabels
      />
    );
    expect(screen.queryByText('Stock:')).toBeNull();
  });

  it('drops the redundant word from the tabs themselves', () => {
    render(<OverflowTabs items={items} activeKey="My Files" showSectionLabels />);
    // The point of the group label: no tab repeats "Stock".
    expect(screen.queryByText('Stock Photos')).toBeNull();
    expect(inline('Photos').length).toBeGreaterThan(0);
  });

  it('renders no inline label unless asked — the nav rails group only their ⋮ menu', () => {
    render(<OverflowTabs items={items} activeKey="My Files" />);
    expect(screen.queryByText('Stock:')).toBeNull();
  });

  it('starts a new label when the group changes back and forth', () => {
    render(
      <OverflowTabs
        items={[
          { key: 'a', label: 'A', section: 'Stock' },
          { key: 'b', label: 'B' },
          { key: 'c', label: 'C', section: 'Stock' },
        ]}
        activeKey="a"
        showSectionLabels
      />
    );
    expect(screen.getAllByText('Stock:')).toHaveLength(2);
  });
});
