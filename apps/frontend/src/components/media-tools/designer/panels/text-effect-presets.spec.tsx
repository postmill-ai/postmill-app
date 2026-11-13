import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  TextEffectPresets,
  textEffectPatch,
  textEffectResetPatch,
} from './text-effect-presets';
import { createDesignerStore, type DesignerElement } from '../designer.store';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(vars[name]))
      : fallback,
}));

const element = {
  id: 'text-1',
  type: 'text',
  x: 0,
  y: 0,
  width: 400,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  text: 'Effect',
  styles: [{ type: 'drop-shadow' as const }],
} as DesignerElement;

describe('text effect presets', () => {
  it('drives the existing curved and path text fields', () => {
    expect(textEffectPatch('arc', element)).toEqual({ curve: 45, textPath: undefined });
    expect(textEffectPatch('wave', element).textPath).toContain('Q 100');
    expect(textEffectPatch('circle', element).textPath).toContain('A 40,40');
  });

  it('drives gradient, outline, and shadow without a renderer fork', () => {
    expect(textEffectPatch('gradient', element).fillGradient?.stops).toHaveLength(2);
    expect(textEffectPatch('outline', element).textStroke).toEqual({ color: '#000000', width: 2 });
    expect(textEffectPatch('shadow', element).textShadow?.blur).toBe(8);
  });

  it('adds one bounded 3D extrusion style without removing existing effects', () => {
    const patch = textEffectPatch('extrusion', element);
    expect(patch.styles).toHaveLength(2);
    expect(patch.styles?.[0].type).toBe('drop-shadow');
    expect(patch.styles?.[1]).toMatchObject({ type: 'extrusion', depth: 24 });
    expect(textEffectPatch('extrusion', { ...element, styles: patch.styles }).styles).toHaveLength(2);
  });

  it('sizes effects per selected element and commits one history entry', () => {
    const store = createDesignerStore();
    const second = { ...element, id: 'text-2', width: 800, height: 200 };
    store.getState().addElement(element);
    store.getState().addElement(second);
    const history = store.getState().history.length;
    render(<TextEffectPresets store={store} textElements={[element, second]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Wave text' }));

    const children = store.getState().doc.outputs[0].children;
    expect(children[0].textPath).toContain('Q 100');
    expect(children[1].textPath).toContain('Q 200');
    expect(store.getState().history.length).toBe(history + 1);
  });

  it('previews and restores without history or dirty state, then commits once', () => {
    const store = createDesignerStore();
    store.getState().addElement(element);
    store.getState().markSaved();
    const before = store.getState().doc;
    const history = store.getState().history.length;
    render(<TextEffectPresets store={store} textElements={[element]} />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Text shadow' }));
    expect(store.getState().doc.outputs[0].children[0].textShadow?.blur).toBe(8);
    expect(store.getState().history.length).toBe(history);
    expect(store.getState().isDirty).toBe(false);
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'Text shadow' }));
    expect(store.getState().doc).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: 'Text shadow' }));
    expect(store.getState().history.length).toBe(history + 1);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children[0].textShadow).toBeUndefined();
  });

  it('restores the preview baseline before a real store edit', () => {
    const store = createDesignerStore();
    store.getState().addElement({ ...element, fontSize: 32 });
    const id = store.getState().doc.outputs[0].children[0].id;
    store.getState().previewElements({ [id]: { fontSize: 72 } });

    store.getState().updateElement(id, { fill: '#abcdef' });

    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({
      fontSize: 32,
      fill: '#abcdef',
    });
  });

  it('resets only the requested effect and never rasterizes the text', () => {
    const store = createDesignerStore();
    store.getState().addElement(element);
    render(<TextEffectPresets store={store} textElements={[element]} />);

    for (const name of ['Arc text', 'Wave text', 'Circle text', 'Text shadow']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(store.getState().doc.outputs[0].children).toHaveLength(1);
    expect(store.getState().doc.outputs[0].children[0].type).toBe('text');
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children[0].textShadow).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /Reset Circle text/ }));
    const current = store.getState().doc.outputs[0].children[0];
    expect(current.textPath).toBeUndefined();
    expect(current.curve).toBe(0);
    expect(current.styles).toEqual(element.styles);
    expect(textEffectResetPatch('shadow', current).textPath).toBeUndefined();
  });
});
