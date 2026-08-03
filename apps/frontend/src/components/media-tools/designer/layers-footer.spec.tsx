import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { LayersFooter } from './panels/layers-footer';
import { createDesignerStore, type DesignerElement } from './designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const shape = (id: string): DesignerElement =>
  ({
    id,
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
  }) as DesignerElement;

const withLayers = (count: number) => {
  const store = createDesignerStore();
  for (let i = 0; i < count; i++) store.getState().addElement(shape(''));
  return store;
};

const button = (label: string) => screen.getByRole('button', { name: label });

describe('LayersFooter', () => {
  it('renders Photoshop\'s seven slots in order', () => {
    render(<LayersFooter store={withLayers(1)} />);
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toHaveLength(7);
    expect(labels[0]).toMatch(/Formats|Unlink/);
    expect(labels[1]).toBe('Layer Style');
    expect(labels[2]).toBe('Create Clipping Mask');
    expect(labels[3]).toBe('New Fill or Adjustment Layer');
    expect(labels[4]).toBe('New Group');
    expect(labels[5]).toBe('New Layer');
    expect(labels[6]).toBe('Delete');
  });

  it('disables the selection-dependent buttons with nothing selected', () => {
    const store = withLayers(1);
    store.getState().setSelectedIds([]);
    render(<LayersFooter store={store} />);

    expect((button('Delete') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Create Clipping Mask') as HTMLButtonElement).disabled).toBe(true);
    expect((button('New Group') as HTMLButtonElement).disabled).toBe(true);
    // Creating a layer never needs a selection.
    expect((button('New Layer') as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables group and delete once a layer is selected', () => {
    const store = withLayers(2);
    const [a] = store.getState().doc.outputs[0].children;
    store.getState().setSelectedIds([a.id]);
    render(<LayersFooter store={store} />);

    expect((button('New Group') as HTMLButtonElement).disabled).toBe(false);
    expect((button('Delete') as HTMLButtonElement).disabled).toBe(false);
  });

  it('deletes the whole selection, not just the first layer', () => {
    const store = withLayers(3);
    const ids = store.getState().doc.outputs[0].children.map((c) => c.id);
    store.getState().setSelectedIds([ids[0], ids[2]]);
    render(<LayersFooter store={store} />);

    fireEvent.click(button('Delete'));

    const left = store.getState().doc.outputs[0].children.map((c) => c.id);
    expect(left).toEqual([ids[1]]);
  });

  it('groups the selection through the same action the Layer menu uses', () => {
    const store = withLayers(2);
    const ids = store.getState().doc.outputs[0].children.map((c) => c.id);
    store.getState().setSelectedIds(ids);
    render(<LayersFooter store={store} />);

    fireEvent.click(button('New Group'));

    const children = store.getState().doc.outputs[0].children;
    const group = children.find((c) => c.type === 'group');
    expect(group).toBeTruthy();
    expect(children.filter((c) => c.parentId === group?.id)).toHaveLength(2);
  });

  it('opens the fill/adjustment menu upward and adds the chosen layer', () => {
    const store = withLayers(1);
    render(<LayersFooter store={store} />);

    fireEvent.click(button('New Fill or Adjustment Layer'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Invert' }));

    const adj = store
      .getState()
      .doc.outputs[0].children.find((c) => c.type === 'adjustment');
    expect(adj?.adjustment?.type).toBe('invert');
  });

  it('toggles the cross-format link on the selection', () => {
    // Elements are linked-by-default, so the button starts as Unlink and the
    // label has to follow the selection rather than being fixed.
    const store = withLayers(1);
    const [el] = store.getState().doc.outputs[0].children;
    expect(el.originId).toBeTruthy();
    store.getState().setSelectedIds([el.id]);
    const view = render(<LayersFooter store={store} />);

    fireEvent.click(button('Unlink'));
    const unlinked = store.getState().doc.outputs[0].children.find((c) => c.id === el.id);
    expect(unlinked?.originId).toBeFalsy();

    view.rerender(<LayersFooter store={store} />);
    fireEvent.click(button('Apply to All Formats'));
    expect(
      store.getState().doc.outputs[0].children.find((c) => c.id === el.id)?.originId
    ).toBeTruthy();
  });
});
