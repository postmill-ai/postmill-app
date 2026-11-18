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

describe('CommonInspector group geometry', () => {
  it('shows member-derived bounds and edits members instead of the zero-sized container', () => {
    const store = createDesignerStore();
    store.getState().addElement({
      ...element('shape'), id: 'a', x: 10, y: 20, width: 30, height: 40,
    });
    store.getState().addElement({
      ...element('text'), id: 'b', x: 50, y: 10, width: 10, height: 10,
    });
    store.getState().groupSelection(['a', 'b']);
    const before = children(store);
    const group = before.find((el) => el.type === 'group')!;
    const { rerender } = render(<CommonInspector selected={[group]} ids={[group.id]} store={store} />);

    expect((screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement).value).toBe('10');
    expect((screen.getByRole('spinbutton', { name: 'Y' }) as HTMLInputElement).value).toBe('10');
    expect((screen.getByRole('spinbutton', { name: 'W' }) as HTMLInputElement).value).toBe('50');
    expect((screen.getByRole('spinbutton', { name: 'H' }) as HTMLInputElement).value).toBe('50');

    const x = screen.getByRole('spinbutton', { name: 'X' });
    fireEvent.change(x, { target: { value: '30' } });
    fireEvent.blur(x);
    let current = children(store);
    expect(current.find((el) => el.id === 'a')).toMatchObject({ x: 30, y: 20, width: 30, height: 40 });
    expect(current.find((el) => el.id === 'b')).toMatchObject({ x: 70, y: 10, width: 10, height: 10 });
    expect(current.find((el) => el.id === group.id)).toMatchObject({ x: 0, y: 0, width: 0, height: 0 });
    const beforeResize = current;

    rerender(<CommonInspector selected={[current.find((el) => el.id === group.id)!]} ids={[group.id]} store={store} />);
    const width = screen.getByRole('spinbutton', { name: 'W' });
    fireEvent.change(width, { target: { value: '100' } });
    fireEvent.blur(width);
    current = children(store);
    expect(current.find((el) => el.id === 'a')).toMatchObject({ x: 30, width: 60 });
    expect(current.find((el) => el.id === 'b')).toMatchObject({ x: 110, width: 20 });
    expect(current.find((el) => el.id === group.id)).toMatchObject({ x: 0, width: 0 });

    act(() => store.getState().undo());
    expect(children(store)).toEqual(beforeResize);
    act(() => store.getState().undo());
    expect(children(store)).toEqual(before);
  });
  it('derives bounds from the active carousel page rather than page 1', () => {
    const store = createDesignerStore();
    store.getState().addElement({ ...element('shape'), x: 0, y: 0, width: 400, height: 400 });
    store.getState().addPage();
    store.getState().addElement({ ...element('shape'), x: 25, y: 35, width: 50, height: 60 });
    store.getState().addElement({ ...element('text'), x: 100, y: 120, width: 80, height: 30 });
    const page = store.getState().doc.outputs[0].pages![0].children;
    store.getState().groupSelection(page.map((el) => el.id));
    const groupedPage = store.getState().doc.outputs[0].pages![0].children;
    const group = groupedPage.find((el) => el.type === 'group')!;
    render(<CommonInspector selected={[group]} ids={[group.id]} store={store} />);

    expect((screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement).value).toBe('25');
    expect((screen.getByRole('spinbutton', { name: 'Y' }) as HTMLInputElement).value).toBe('35');
    expect((screen.getByRole('spinbutton', { name: 'W' }) as HTMLInputElement).value).toBe('155');
    expect((screen.getByRole('spinbutton', { name: 'H' }) as HTMLInputElement).value).toBe('115');
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
