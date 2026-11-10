import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommonInspector } from './common-inspector';
import { createDesignerStore, type DesignerElement } from '../designer.store';
import { SELECTABLE_BLEND_MODES } from '@postmill-ai/nestjs-libraries/media/designer-doc/pixel-ops';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const element = (type: DesignerElement['type']): DesignerElement =>
  ({
    id: '',
    type,
    shape: type === 'shape' ? 'rect' : undefined,
    text: type === 'text' ? 'Blend me' : undefined,
    src: type === 'image' || type === 'icon' ? '/image.png' : undefined,
    points: type === 'path' ? [0, 0, 20, 20] : undefined,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
  }) as DesignerElement;

const children = (store: ReturnType<typeof createDesignerStore>) =>
  store.getState().doc.outputs[0].children!;

describe('CommonInspector blend modes', () => {
  it('uses the shared mode list and applies every mode to a mixed multi-selection with undoable edits', () => {
    const store = createDesignerStore();
    for (const type of ['text', 'shape', 'image', 'icon', 'path', 'group', 'fill'] as const) {
      store.getState().addElement(element(type));
    }
    const selected = children(store);
    const ids = selected.map((el) => el.id);
    store.getState().setSelectedIds(ids);
    const { rerender } = render(<CommonInspector selected={selected} ids={ids} store={store} />);

    const select = screen.getByRole('combobox', { name: 'Blend mode' });
    expect(select.querySelectorAll('option')).toHaveLength(SELECTABLE_BLEND_MODES.length);
    expect(screen.getByRole('option', { name: 'Normal' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Multiply' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Screen' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Overlay' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Soft Light' })).toBeTruthy();

    for (const blendMode of ['multiply', 'screen', 'overlay', 'soft-light'] as const) {
      act(() => {
        fireEvent.change(select, { target: { value: blendMode } });
      });
      expect(children(store).every((el) => el.blendMode === blendMode)).toBe(true);
      rerender(<CommonInspector selected={children(store)} ids={ids} store={store} />);
      expect((select as HTMLSelectElement).value).toBe(blendMode);
    }

    act(() => {
      store.getState().undo();
    });
    expect(children(store).every((el) => el.blendMode === 'overlay')).toBe(true);
    act(() => {
      store.getState().redo();
    });
    expect(children(store).every((el) => el.blendMode === 'soft-light')).toBe(true);
  });

  it('shows the primary selection’s current mode and clears it back to Normal', () => {
    const store = createDesignerStore();
    store.getState().addElement({ ...element('text'), blendMode: 'screen' });
    const selected = children(store);
    const ids = [selected[0].id];
    store.getState().setSelectedIds(ids);
    render(<CommonInspector selected={selected} ids={ids} store={store} />);

    const select = screen.getByRole('combobox', { name: 'Blend mode' });
    expect((select as HTMLSelectElement).value).toBe('screen');
    fireEvent.change(select, { target: { value: 'normal' } });
    expect(children(store)[0].blendMode).toBe('normal');
  });
});

describe('CommonInspector geometry history', () => {
  it('commits a typed width once on blur so one Undo restores the original width', () => {
    const store = createDesignerStore();
    store.getState().addElement({ ...element('image'), width: 486, height: 864 });
    const selected = children(store);
    const ids = [selected[0].id];
    store.getState().setSelectedIds(ids);
    render(<CommonInspector selected={selected} ids={ids} store={store} />);

    const width = screen.getByRole('spinbutton', { name: 'W' });
    fireEvent.change(width, { target: { value: '60' } });
    fireEvent.change(width, { target: { value: '600' } });
    fireEvent.blur(width);
    expect(children(store)[0].width).toBe(600);

    act(() => {
      store.getState().undo();
    });
    expect(children(store)[0].width).toBe(486);
  });
});
