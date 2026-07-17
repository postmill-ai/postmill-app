import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { MenuBar } from './menu-bar';
import type { DesignerAction } from './actions';

// MenuBar now calls useT() to translate menu/action labels (i18n sweep). Mock the
// translation client like other specs so it resolves to the English fallback.
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
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
    { id: 'safe', label: 'Safe Zones', menu: 'options', checked: () => true, run: vi.fn() },
  ];
  return { actions, saveRun, undoRun };
};

describe('MenuBar', () => {
  it('renders a trigger per non-empty menu only', () => {
    const { actions } = build();
    render(<MenuBar actions={actions} />);
    expect(screen.getByText('File')).toBeDefined();
    expect(screen.getByText('Edit')).toBeDefined();
    expect(screen.getByText('Options')).toBeDefined();
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
    fireEvent.click(screen.getByText('Options'));
    const item = screen.getByText('Safe Zones').closest('button')!;
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('true');
  });
});
