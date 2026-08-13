import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { KebabMenu } from './kebab-menu';

afterEach(cleanup);

const open = (name = 'Actions') => fireEvent.click(screen.getByRole('button', { name }));

describe('KebabMenu', () => {
  it('stays closed until asked', () => {
    render(<KebabMenu ariaLabel="Actions" items={[{ label: 'Edit', onClick: vi.fn() }]} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs an item and closes', () => {
    const onClick = vi.fn();
    render(<KebabMenu ariaLabel="Actions" items={[{ label: 'Edit', onClick }]} />);

    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on an outside click', () => {
    render(<KebabMenu ariaLabel="Actions" items={[{ label: 'Edit' }]} />);

    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders section headers as non-interactive labels', () => {
    // The grouped overflow menu (/media, /settings) leans on this: a flat list
    // of 40+ studios is unscannable.
    render(
      <KebabMenu
        ariaLabel="More tools"
        items={[
          { header: 'AI Media' },
          { label: 'OpenAI', onClick: vi.fn() },
          { header: 'Content Pack' },
          { label: 'Icons', onClick: vi.fn() },
        ]}
      />
    );

    open('More tools');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('AI Media')).toBeTruthy();
    expect(within(menu).getByText('Content Pack')).toBeTruthy();
    // Headers are labels, not choices.
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
  });

  it('caps its height so a long grouped menu cannot run off a phone', () => {
    render(
      <KebabMenu
        ariaLabel="More tools"
        items={Array.from({ length: 44 }, (_, i) => ({ label: `Item ${i}` }))}
      />
    );

    open('More tools');
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('max-h-[70vh]');
    expect(menu.className).toContain('overflow-y-auto');
  });

  it('renders dividers and link items', () => {
    render(
      <KebabMenu
        ariaLabel="Actions"
        items={[
          { label: 'Open', href: '/somewhere' },
          { divider: true },
          { label: 'Delete', danger: true, onClick: vi.fn() },
        ]}
      />
    );

    open();
    expect(screen.getByRole('menuitem', { name: 'Open' }).getAttribute('href')).toBe('/somewhere');
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('text-red-700');
  });

  it('accepts a labelled trigger in place of the dots', () => {
    render(<KebabMenu ariaLabel="New design" trigger={<span>+ New Design</span>} items={[{ label: 'Designer' }]} />);
    expect(screen.getByRole('button', { name: 'New design' }).textContent).toBe('+ New Design');
  });
});
