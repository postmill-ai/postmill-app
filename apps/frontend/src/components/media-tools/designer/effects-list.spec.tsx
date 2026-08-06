import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { EffectsList } from './panels/effects-list';
import { createDesignerStore, type DesignerElement } from './designer.store';
import { LAYER_STYLE_DESCRIPTORS } from '@postmill-ai/nestjs-libraries/media/designer-doc/layer-style-descriptors';

/**
 * Layer styles were add-only: the Layer Style menu applied `defaultStyle` and
 * nothing could ever read or change a parameter again. These pin the editor
 * that was missing, and the schema bounds it has to stay inside.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));

afterEach(cleanup);

const withStyles = (styles: DesignerElement['styles']) => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: '',
    type: 'shape',
    shape: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    styles,
  } as DesignerElement);
  const el = store.getState().doc.outputs[0].children[0] as DesignerElement;
  return { store, el };
};

const current = (store: ReturnType<typeof createDesignerStore>) =>
  store.getState().doc.outputs[0].children[0] as DesignerElement;

describe('EffectsList', () => {
  it('says so plainly when a layer has no effects', () => {
    const { store, el } = withStyles(undefined);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);
    expect(screen.getByText('No effects on this layer.')).toBeTruthy();
  });

  it('adds an effect at its defaults', () => {
    const { store, el } = withStyles(undefined);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);

    fireEvent.change(screen.getByLabelText('Add effect'), { target: { value: 'outer-glow' } });

    const styles = current(store).styles || [];
    expect(styles).toHaveLength(1);
    expect(styles[0].type).toBe('outer-glow');
    // Visible, not a no-op.
    expect(styles[0].enabled).toBe(true);
    expect(styles[0].size).toBeGreaterThan(0);
  });

  it('writes a parameter change back onto the style', () => {
    const { store, el } = withStyles([
      { type: 'outer-glow', enabled: true, color: '#ffd966', size: 12, spread: 10, opacity: 0.75 },
    ]);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '40' } });

    expect(current(store).styles?.[0].size).toBe(40);
    // Sibling values are carried, not dropped.
    expect(current(store).styles?.[0].spread).toBe(10);
  });

  it('toggles an effect without discarding its settings', () => {
    const { store, el } = withStyles([
      { type: 'drop-shadow', enabled: true, color: '#000000', size: 8, distance: 6 },
    ]);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);

    fireEvent.click(screen.getByLabelText('Hide effect'));

    expect(current(store).styles?.[0].enabled).toBe(false);
    expect(current(store).styles?.[0].size).toBe(8);
  });

  it('removes an effect', () => {
    const { store, el } = withStyles([
      { type: 'drop-shadow', enabled: true },
      { type: 'stroke', enabled: true },
    ]);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);

    fireEvent.click(screen.getByLabelText('Remove Drop Shadow'));

    const types = (current(store).styles || []).map((s) => s.type);
    expect(types).toEqual(['stroke']);
  });

  it('retunes rather than stacking a second copy of the same effect', () => {
    const { store, el } = withStyles([{ type: 'stroke', enabled: true, size: 20 }]);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);

    fireEvent.change(screen.getByLabelText('Add effect'), { target: { value: 'stroke' } });

    expect(current(store).styles).toHaveLength(1);
  });

  it('offers stroke placement, which only stroke has', () => {
    const { store, el } = withStyles([{ type: 'stroke', enabled: true, position: 'outside' }]);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);

    fireEvent.click(screen.getByText('Inside'));

    expect(current(store).styles?.[0].position).toBe('inside');
  });

  it('hides the parameters of a switched-off effect', () => {
    const { store, el } = withStyles([{ type: 'outer-glow', enabled: false, size: 12 }]);
    render(<EffectsList element={el} ids={[el.id]} store={store} />);
    expect(screen.queryByLabelText('Size')).toBeNull();
  });
});

describe('LAYER_STYLE_DESCRIPTORS', () => {
  it('covers every style type exactly once', () => {
    const types = LAYER_STYLE_DESCRIPTORS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toHaveLength(10);
  });

  it('keeps every slider inside what the schema accepts', () => {
    // The schema is stricter than it looks: opacity is 0-1, spread is a
    // percentage, distance and size are capped by MAX_DIMENSION.
    for (const d of LAYER_STYLE_DESCRIPTORS) {
      for (const p of d.params) {
        expect(p.min).toBeGreaterThanOrEqual(0);
        if (p.key === 'opacity') expect(p.max).toBe(1);
        if (p.key === 'spread') expect(p.max).toBe(100);
        if (p.key === 'depth') expect(p.max).toBeLessThanOrEqual(1000);
        expect(p.step).toBeGreaterThan(0);
      }
    }
  });
});
