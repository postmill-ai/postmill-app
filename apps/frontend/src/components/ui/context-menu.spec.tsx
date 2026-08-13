import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from './context-menu';

const resize = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true, configurable: true });
};

// jsdom reports 0 for every measurement; give the menu a real box so the
// clamping maths has something to work with.
const stubMenuSize = (width = 190, height = 120) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

const items = (onClick = vi.fn()): ContextMenuItem[] => [
  { label: 'Rename', onClick },
  { divider: true },
  { label: 'Delete', onClick, danger: true },
];

beforeEach(() => resize(1280, 800));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ContextMenu', () => {
  it('renders items into a portal on document.body', () => {
    const { container } = render(
      <ContextMenu x={10} y={10} items={items()} onClose={vi.fn()} ariaLabel="File actions" />
    );

    // Nothing inline — the portal is what keeps a fixed menu out of scrolling
    // and transformed ancestors.
    expect(container.innerHTML).toBe('');
    const menu = screen.getByRole('menu', { name: 'File actions' });
    expect(document.body.contains(menu)).toBe(true);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('invokes the item and closes on click', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} items={items(onClick)} onClose={onClose} ariaLabel="File actions" />
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items()} onClose={onClose} ariaLabel="File actions" />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on outside mousedown, not on outside click', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items()} onClose={onClose} ariaLabel="File actions" />);

    // click alone must not close — otherwise the menu eats the first click of
    // whatever the user is reaching for underneath.
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when interacting inside the menu', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items()} onClose={onClose} ariaLabel="File actions" />);

    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('clamps against the right and bottom viewport edges', () => {
    stubMenuSize(190, 120);
    resize(1000, 600);

    render(<ContextMenu x={980} y={590} items={items()} onClose={vi.fn()} ariaLabel="File actions" />);

    const menu = screen.getByRole('menu');
    // 1000 - 190 - 8 = 802 ; 600 - 120 - 8 = 472
    expect(menu.style.left).toBe('802px');
    expect(menu.style.top).toBe('472px');
  });

  it('clamps against the left and top edges', () => {
    stubMenuSize(190, 120);

    render(<ContextMenu x={-50} y={-50} items={items()} onClose={vi.fn()} ariaLabel="File actions" />);

    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe('8px');
    expect(menu.style.top).toBe('8px');
  });

  it('focuses the first item on open and restores focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <ContextMenu x={10} y={10} items={items()} onClose={vi.fn()} ariaLabel="File actions" />
    );

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('moves focus with the arrow keys, wrapping past dividers', () => {
    render(<ContextMenu x={10} y={10} items={items()} onClose={vi.fn()} ariaLabel="File actions" />);
    const menu = screen.getByRole('menu');
    const [rename, del] = screen.getAllByRole('menuitem');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(del);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rename);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(del);

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(rename);
  });

  it('does not fire disabled items', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{ label: 'Rename', onClick, disabled: true }]}
        onClose={onClose}
        ariaLabel="File actions"
      />
    );

    const item = screen.getByRole('menuitem', { name: 'Rename' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    fireEvent.click(item);

    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
