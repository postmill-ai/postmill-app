import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { AdjustmentInspector } from './panels/adjustment-inspector';
import { createDesignerStore, type DesignerElement } from './designer.store';
import type { DesignerAdjustment } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

/**
 * Adjustment layers were add-only: `defaultAdjustmentValues` was read once at
 * creation and nothing ever wrote `adjustment.values` again, so all sixteen
 * were frozen at their defaults. These pin the write path.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

// The colour picker reaches for the logged-in org to remember recent swatches.
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1' }),
}));

afterEach(cleanup);

const withAdjustment = (adjustment: DesignerAdjustment) => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: '',
    type: 'adjustment',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    adjustment,
  } as DesignerElement);
  const el = store.getState().doc.outputs[0].children[0];
  return { store, el };
};

const current = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0].children[0] as DesignerElement)
    .adjustment as DesignerAdjustment;

describe('AdjustmentInspector', () => {
  it('renders one slider per parameter of the adjustment', () => {
    const { store, el } = withAdjustment({
      type: 'brightness-contrast',
      values: { brightness: 0, contrast: 0 },
    });
    render(<AdjustmentInspector element={el} store={store} />);

    expect(screen.getByLabelText('Brightness')).toBeTruthy();
    expect(screen.getByLabelText('Contrast')).toBeTruthy();
  });

  it('writes a slider change back onto the layer', () => {
    const { store, el } = withAdjustment({
      type: 'brightness-contrast',
      values: { brightness: 0, contrast: 0 },
    });
    render(<AdjustmentInspector element={el} store={store} />);

    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '35' } });

    expect(current(store).values?.brightness).toBe(35);
    // The other value is carried, not dropped.
    expect(current(store).values?.contrast).toBe(0);
  });

  it('keeps the adjustment type when a value changes', () => {
    const { store, el } = withAdjustment({ type: 'exposure', values: { exposure: 0, offset: 0 } });
    render(<AdjustmentInspector element={el} store={store} />);

    fireEvent.change(screen.getByLabelText('Exposure'), { target: { value: '1.5' } });

    expect(current(store).type).toBe('exposure');
    expect(current(store).values?.exposure).toBe(1.5);
  });

  it('fills in a value the layer was saved without', () => {
    // Older documents stored only the keys that had been touched.
    const { store, el } = withAdjustment({ type: 'hue-saturation', values: {} });
    render(<AdjustmentInspector element={el} store={store} />);

    fireEvent.change(screen.getByLabelText('Hue'), { target: { value: '90' } });

    expect(current(store).values).toMatchObject({
      hue: 90,
      saturation: 0,
      lightness: 0,
    });
  });

  it('renders a checkbox, not a slider, for a boolean parameter', () => {
    const { store, el } = withAdjustment({
      type: 'photo-filter',
      values: { density: 25, preserveLuminosity: 1 },
    });
    render(<AdjustmentInspector element={el} store={store} />);

    const box = screen.getByRole('checkbox', { name: 'Preserve luminosity' }) as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(current(store).values?.preserveLuminosity).toBe(0);
  });

  it('shows the curves grid for Curves and nothing else', () => {
    const { store, el } = withAdjustment({ type: 'curves', curves: { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } });
    render(<AdjustmentInspector element={el} store={store} />);

    expect(screen.getByRole('application', { name: 'Curves editor' })).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('shows the ramp for Gradient Map', () => {
    const { store, el } = withAdjustment({
      type: 'gradient-map',
      gradient: {
        type: 'linear',
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      },
    });
    render(<AdjustmentInspector element={el} store={store} />);
    expect(screen.getByText('Ramp')).toBeTruthy();
  });

  it('says so plainly when there is nothing to configure', () => {
    const { store, el } = withAdjustment({ type: 'invert' });
    render(<AdjustmentInspector element={el} store={store} />);
    expect(screen.getByText('This adjustment has no settings.')).toBeTruthy();
  });

  it('resets to the neutral defaults', () => {
    const { store, el } = withAdjustment({
      type: 'brightness-contrast',
      values: { brightness: 80, contrast: -40 },
    });
    render(<AdjustmentInspector element={el} store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(current(store).values).toEqual({ brightness: 0, contrast: 0 });
  });

  it('renders nothing for a layer with no adjustment on it', () => {
    const store = createDesignerStore();
    const { container } = render(
      <AdjustmentInspector element={{ id: 'x', type: 'adjustment' } as DesignerElement} store={store} />
    );
    expect(container.firstChild).toBeNull();
  });
});
