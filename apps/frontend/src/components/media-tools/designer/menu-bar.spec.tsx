import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { MenuBar } from './menu-bar';
import type { DesignerAction } from './actions';

// MenuBar now calls useT() to translate menu/action labels (i18n sweep). Mock the
// translation client like other specs so it resolves to the English fallback.
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const build = () => {
  const saveRun = vi.fn();
  const undoRun = vi.fn();
  const actions: DesignerAction[] = [
    { id: 'save', label: 'Save', menu: 'file', shortcut: '⌘S', run: saveRun },
    { id: 'export', label: 'Export…', menu: 'file', run: vi.fn() },
    { id: 'undo', label: 'Undo', menu: 'edit', enabled: () => false, run: undoRun },
    { id: 'safe', label: 'Safe Zones', menu: 'view', checked: () => true, run: vi.fn() },
  ];
  return { actions, saveRun, undoRun };
};

describe('MenuBar', () => {
  it('renders a trigger per non-empty menu only', () => {
    const { actions } = build();
    render(<MenuBar actions={actions} />);
    expect(screen.getByText('File')).toBeDefined();
    expect(screen.getByText('Edit')).toBeDefined();
    expect(screen.getByText('View')).toBeDefined();
    expect(screen.queryByText('Window')).toBeNull();
  });

  it('opens a dropdown on click and lists its items', () => {
    const { actions } = build();
    render(<MenuBar actions={actions} />);
    fireEvent.click(screen.getByText('File'));
    expect(screen.getByText('Save')).toBeDefined();
    expect(screen.getByText('Export…')).toBeDefined();
  });

  it('runs an action and closes the menu', () => {
    const { actions, saveRun } = build();
    render(<MenuBar actions={actions} />);
    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Save'));
    expect(saveRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Export…')).toBeNull();
  });

  it('disables items whose enabled() is false', () => {
    const { actions, undoRun } = build();
    render(<MenuBar actions={actions} />);
    fireEvent.click(screen.getByText('Edit'));
    const item = screen.getByText('Undo').closest('button')!;
    expect(item.hasAttribute('disabled')).toBe(true);
    fireEvent.click(item);
    expect(undoRun).not.toHaveBeenCalled();
  });

  it('marks a checked toggle with aria-checked', () => {
    const { actions } = build();
    render(<MenuBar actions={actions} />);
    fireEvent.click(screen.getByText('View'));
    const item = screen.getByText('Safe Zones').closest('button')!;
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps a tall submenu inside a short viewport', () => {
    const box = (left: number, top: number, width: number, height: number): DOMRect => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-submenu-flyout')) return box(300, 480, 230, 504);
      if (this.getAttribute('role') === 'menuitem' && this.textContent?.includes('Format')) {
        return box(100, 480, 200, 30);
      }
      return box(0, 0, 0, 0);
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
      return this.hasAttribute('data-submenu-flyout') ? 637 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
      return this.hasAttribute('data-submenu-flyout') ? 502 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.hasAttribute('data-submenu-flyout') ? 228 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.hasAttribute('data-submenu-flyout') ? 228 : 0;
    });

    try {
      const actions: DesignerAction[] = Array.from({ length: 16 }, (_, index) => ({
        id: `format-${index}`,
        label: `Format action ${index}`,
        menu: 'file',
        submenuPath: ['Format'],
        run: vi.fn(),
      }));
      render(<MenuBar actions={actions} />);
      fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
      fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Format/ }));

      const flyout = document.querySelector<HTMLElement>('[data-submenu-flyout]')!;
      expect(flyout.style.top).toBe('8px');
      expect(flyout.style.maxHeight).toBe('506px');
      expect(Number.parseFloat(flyout.style.top) + Number.parseFloat(flyout.style.maxHeight))
        .toBeLessThanOrEqual(720);
      expect(flyout.style.visibility).toBe('visible');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
