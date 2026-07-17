import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer } from './drawer';

function getPanel(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  // dialog children: [0] backdrop, [1] sliding panel
  return dialog.querySelectorAll(':scope > div')[1] as HTMLElement;
}

function getBackdrop(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  return dialog.querySelectorAll(':scope > div')[0] as HTMLElement;
}

describe('Drawer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <Drawer open={false} onClose={vi.fn()}>
        <span>hidden</span>
      </Drawer>
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('portals its content into document.body when open', () => {
    render(
      <Drawer open onClose={vi.fn()} ariaLabel="My Drawer">
        <span>drawer body</span>
      </Drawer>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('My Drawer');
    // The dialog lives under document.body (portal), not the render container.
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByText('drawer body')).toBeTruthy();
  });

  it('calls onClose when Escape is pressed (no onEscape override)', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <span>x</span>
      </Drawer>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('prefers onEscape over onClose when provided', () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(
      <Drawer open onClose={onClose} onEscape={onEscape}>
        <span>x</span>
      </Drawer>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <span>x</span>
      </Drawer>
    );
    fireEvent.click(getBackdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape/Tab keys', () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <span>x</span>
      </Drawer>
    );
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('traps focus: Tab on the last element wraps to the first', () => {
    render(
      <Drawer open onClose={vi.fn()}>
        <button>first</button>
        <button>last</button>
      </Drawer>
    );
    const first = screen.getByText('first');
    const last = screen.getByText('last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('traps focus: Shift+Tab on the first element wraps to the last', () => {
    render(
      <Drawer open onClose={vi.fn()}>
        <button>first</button>
        <button>last</button>
      </Drawer>
    );
    const first = screen.getByText('first');
    const last = screen.getByText('last');
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('traps focus onto the panel when there are no focusable children', () => {
    render(
      <Drawer open onClose={vi.fn()}>
        <div>just text</div>
      </Drawer>
    );
    const panel = getPanel();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(panel);
  });

  it('with two stacked drawers, Esc closes only the top one, then the next (6.4)', () => {
    const onClose1 = vi.fn();
    const onClose2 = vi.fn();
    const TwoDrawers: React.FC = () => {
      const [open1, setOpen1] = React.useState(true);
      const [open2, setOpen2] = React.useState(true);
      return (
        <>
          <Drawer
            open={open1}
            onClose={() => {
              onClose1();
              setOpen1(false);
            }}
          >
            <span>drawer-1</span>
          </Drawer>
          <Drawer
            open={open2}
            onClose={() => {
              onClose2();
              setOpen2(false);
            }}
          >
            <span>drawer-2</span>
          </Drawer>
        </>
      );
    };

    render(<TwoDrawers />);
    expect(screen.getByText('drawer-1')).toBeTruthy();
    expect(screen.getByText('drawer-2')).toBeTruthy();

    // First Esc: only the later-mounted (top-of-stack) drawer closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose2).toHaveBeenCalledTimes(1);
    expect(onClose1).not.toHaveBeenCalled();
    expect(screen.queryByText('drawer-2')).toBeNull();
    expect(screen.getByText('drawer-1')).toBeTruthy();

    // Second Esc: the remaining drawer is now top and closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose1).toHaveBeenCalledTimes(1);
    expect(onClose2).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('drawer-1')).toBeNull();
  });

  it('restores focus to the previously-focused element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'opener';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Drawer open onClose={vi.fn()}>
        <span>x</span>
      </Drawer>
    );
    rerender(
      <Drawer open={false} onClose={vi.fn()}>
        <span>x</span>
      </Drawer>
    );
    expect(document.activeElement).toBe(trigger);
  });
});
