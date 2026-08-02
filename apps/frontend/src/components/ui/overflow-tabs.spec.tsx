import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OverflowTabs, splitOverflowItems, type OverflowTabItem } from './overflow-tabs';

const items = (n: number): OverflowTabItem[] =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `Tab ${i}` }));

const inlineNames = () =>
  [...document.querySelectorAll('[data-overflow-slot="inline"]')].map((e) => e.textContent);
const desktopOnlyNames = () =>
  [...document.querySelectorAll('[data-overflow-slot="desktop-only"]')].map((e) => e.textContent);

afterEach(cleanup);

describe('splitOverflowItems', () => {
  it('keeps everything inline when it fits', () => {
    const { visible, overflow } = splitOverflowItems(items(3), 'k0');
    expect(visible).toHaveLength(3);
    expect(overflow).toHaveLength(0);
  });

  it('shows the first three and folds the rest', () => {
    const { visible, overflow } = splitOverflowItems(items(7), 'k1');
    expect(visible.map((i) => i.key)).toEqual(['k0', 'k1', 'k2']);
    expect(overflow.map((i) => i.key)).toEqual(['k3', 'k4', 'k5', 'k6']);
  });

  it('pulls a hidden active item into the last visible slot', () => {
    // Landing on /analytics?tab=usage must not show three tabs with none selected.
    const { visible, overflow } = splitOverflowItems(items(7), 'k6');
    expect(visible.map((i) => i.key)).toEqual(['k0', 'k1', 'k6']);
    expect(overflow.map((i) => i.key)).toEqual(['k2', 'k3', 'k4', 'k5']);
  });

  it('never loses or duplicates an item', () => {
    for (const active of ['k0', 'k3', 'k6', undefined]) {
      const { visible, overflow } = splitOverflowItems(items(7), active);
      const keys = [...visible, ...overflow].map((i) => i.key).sort();
      expect(new Set(keys).size).toBe(7);
      expect(keys).toHaveLength(7);
    }
  });

  it('handles the boundary counts', () => {
    expect(splitOverflowItems([], 'x').visible).toHaveLength(0);
    expect(splitOverflowItems(items(4), 'k3').visible.map((i) => i.key)).toEqual([
      'k0',
      'k1',
      'k3',
    ]);
    expect(splitOverflowItems(items(47), 'k46').overflow).toHaveLength(44);
  });
});

describe('OverflowTabs', () => {
  it('renders three inline and the rest behind the ⋮', () => {
    render(<OverflowTabs items={items(7)} activeKey="k0" ariaLabel="More tabs" />);

    expect(inlineNames()).toEqual(['Tab 0', 'Tab 1', 'Tab 2']);
    expect(desktopOnlyNames()).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'More tabs' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);
  });

  it('renders no overflow trigger when nothing overflows', () => {
    render(<OverflowTabs items={items(3)} activeKey="k0" ariaLabel="More tabs" />);
    expect(screen.queryByRole('button', { name: 'More tabs' })).toBeNull();
  });

  it('keeps the desktop order stable when the active item is pulled forward', () => {
    // Reordering the DOM by activeness would visibly reshuffle desktop tabs.
    render(<OverflowTabs items={items(7)} activeKey="k6" ariaLabel="More tabs" />);
    const all = [...document.querySelectorAll('[data-overflow-slot]')].map((e) => e.textContent);
    expect(all).toEqual(['Tab 0', 'Tab 1', 'Tab 2', 'Tab 3', 'Tab 4', 'Tab 5', 'Tab 6']);
    expect(inlineNames()).toEqual(['Tab 0', 'Tab 1', 'Tab 6']);
  });

  it('never hides the active item in the menu — it is always one of the three', () => {
    render(<OverflowTabs items={items(7)} activeKey="k5" ariaLabel="More tabs" />);

    expect(inlineNames()).toContain('Tab 5');
    fireEvent.click(screen.getByRole('button', { name: 'More tabs' }));
    expect(
      within(screen.getByRole('menu')).queryByRole('menuitem', { name: 'Tab 5' })
    ).toBeNull();
  });

  it('selects from inline and from the menu', () => {
    const onSelect = vi.fn();
    render(
      <OverflowTabs items={items(7)} activeKey="k0" onSelect={onSelect} ariaLabel="More tabs" />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Tab 1' }));
    expect(onSelect).toHaveBeenCalledWith('k1');

    fireEvent.click(screen.getByRole('button', { name: 'More tabs' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tab 4' }));
    expect(onSelect).toHaveBeenCalledWith('k4');
  });

  it('keeps the ⋮ outside the tablist — a menu is not a valid tab', () => {
    render(<OverflowTabs items={items(7)} activeKey="k0" ariaLabel="More tabs" />);

    const track = screen.getByRole('tablist');
    const trigger = screen.getByRole('button', { name: 'More tabs' });
    expect(track.contains(trigger)).toBe(false);
  });

  it('uses navigation semantics for link bars, never tab roles', () => {
    render(
      <OverflowTabs
        items={items(5).map((i) => ({ ...i, href: `/x/${i.key}` }))}
        activeKey="k1"
        semantics="nav"
        ariaLabel="More sections"
      />
    );

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tab 1' }).getAttribute('aria-current')).toBe('page');
  });

  it('uses pressed state for filter pills', () => {
    render(
      <OverflowTabs items={items(5)} activeKey="k0" semantics="toolbar" ariaLabel="More filters" />
    );
    expect(screen.getByRole('button', { name: 'Tab 0' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('groups the overflow menu by section', () => {
    const sectioned: OverflowTabItem[] = [
      { key: 'a', label: 'A', section: 'Platform' },
      { key: 'b', label: 'B', section: 'Platform' },
      { key: 'c', label: 'C', section: 'Platform' },
      { key: 'd', label: 'D', section: 'AI Media' },
      { key: 'e', label: 'E', section: 'AI Media' },
      { key: 'f', label: 'F', section: 'Content Pack' },
    ];
    render(<OverflowTabs items={sectioned} activeKey="a" ariaLabel="More tools" />);
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('AI Media')).toBeTruthy();
    expect(within(menu).getByText('Content Pack')).toBeTruthy();
  });

  it('skips the desktop copies entirely when the host is mobile-only', () => {
    // SubmenuStrip is `hidden mobile:block`; 44 unreachable nodes would be waste.
    render(<OverflowTabs items={items(47)} activeKey="k0" mobileOnly ariaLabel="More" />);
    expect(desktopOnlyNames()).toHaveLength(0);
    expect(inlineNames()).toHaveLength(3);
  });
});
