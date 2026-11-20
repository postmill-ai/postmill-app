import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PagesPanel } from './pages-panel';
import { createDesignerStore } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(vars[key])) : fallback,
}));

vi.mock('../format-thumbnail', () => ({
  FormatThumbnail: () => null,
}));

describe('PagesPanel Carousel', () => {
  it('adds after the selected slide and deletes slide 1 with one Undo', () => {
    const store = createDesignerStore();
    const onContentAdded = vi.fn();
    render(<PagesPanel store={store} visible onContentAdded={onContentAdded} />);

    fireEvent.click(screen.getByRole('button', { name: 'Carousel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add slide after 1' }));
    expect(store.getState().doc.outputs[0].pages).toHaveLength(1);
    expect(store.getState().currentPage).toBe(1);
    expect(onContentAdded).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Page 1 actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate page' }));
    expect(store.getState().doc.outputs[0].pages).toHaveLength(2);
    expect(onContentAdded).toHaveBeenCalledTimes(2);

    const historyLength = store.getState().history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Page 1 actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
    expect(store.getState().doc.outputs[0].pages).toHaveLength(1);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(store.getState().currentPage).toBe(0);

    act(() => store.getState().undo());
    expect(store.getState().doc.outputs[0].pages).toHaveLength(2);
  });

  it('duplicates from right-click, reopens the strip, and explains both views', () => {
    const store = createDesignerStore();
    const onContentAdded = vi.fn();
    render(<PagesPanel store={store} visible onContentAdded={onContentAdded} />);
    const historyLength = store.getState().history.length;

    expect(screen.getByRole('button', { name: 'Pages' }).getAttribute('data-tooltip-content'))
      .toBe('Manage pages in this format');
    expect(screen.getByRole('button', { name: 'Carousel' }).getAttribute('data-tooltip-content'))
      .toBe('Arrange slides; insert or delete at any position');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Page 1' }), {
      clientX: 40, clientY: 50,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate page' }));

    expect(store.getState().doc.outputs[0].pages).toHaveLength(1);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(onContentAdded).toHaveBeenCalledTimes(1);
    act(() => store.getState().undo());
    expect(store.getState().doc.outputs[0].pages).toBeUndefined();
  });

  it('disables every page mutation while the format is frozen', () => {
    const store = createDesignerStore();
    store.getState().addPage();
    store.getState().setOutputFrozen(0, true);
    render(<PagesPanel store={store} visible />);

    fireEvent.click(screen.getByRole('button', { name: 'Page 2 actions' }));
    expect(screen.getByRole('menuitem', { name: 'Duplicate page' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('menuitem', { name: 'Rename page' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('menuitem', { name: 'Delete page' })).toHaveProperty('disabled', true);
  });
});
