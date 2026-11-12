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
    render(<PagesPanel store={store} visible />);

    fireEvent.click(screen.getByRole('button', { name: 'Carousel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add slide after 1' }));
    expect(store.getState().doc.outputs[0].pages).toHaveLength(1);
    expect(store.getState().currentPage).toBe(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate page' })[0]);
    expect(store.getState().doc.outputs[0].pages).toHaveLength(2);

    const historyLength = store.getState().history.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete page' })[0]);
    expect(store.getState().doc.outputs[0].pages).toHaveLength(1);
    expect(store.getState().history).toHaveLength(historyLength + 1);
    expect(store.getState().currentPage).toBe(0);

    act(() => store.getState().undo());
    expect(store.getState().doc.outputs[0].pages).toHaveLength(2);
  });
});
