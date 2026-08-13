import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { ShapeInspector } from './panels/shape-inspector';
import { createDesignerStore, type DesignerElement } from './designer.store';
import { buildPathElement, PEN_DEFAULT_STROKE } from './pen-tools';

/**
 * Pen output was unstylable: `inspector-panel` had no `path` branch, so a path
 * was stuck with its creation-time stroke forever. These pin the styling path
 * and the shape-only controls that must stay hidden for it.
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

const withElement = (patch: Partial<DesignerElement>) => {
  const store = createDesignerStore();
  store.getState().addElement({
    id: '',
    type: 'path',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    nodes: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    stroke: '#000000',
    strokeWidth: 2,
    ...patch,
  } as DesignerElement);
  const el = store.getState().doc.outputs[0].children[0] as DesignerElement;
  return { store, el };
};

const current = (store: ReturnType<typeof createDesignerStore>) =>
  store.getState().doc.outputs[0].children[0] as DesignerElement;

describe('ShapeInspector mounted for a path', () => {
  it('writes a stroke colour onto the path', () => {
    const { store, el } = withElement({});
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    // ColorSwatch renders the hex on the trigger button.
    fireEvent.click(screen.getByRole('button', { name: /#000000/i }));
    const hex = screen.getByLabelText('Hex color') as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#B61A32' } });
    fireEvent.keyDown(hex, { key: 'Enter' });

    expect(current(store).stroke).toBe('#B61A32');
  });

  it('writes a stroke width onto the path', () => {
    const { store, el } = withElement({});
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '6' } });

    expect(current(store).strokeWidth).toBe(6);
  });

  it('hides corner radius for a path — neither renderer reads it', () => {
    const { store, el } = withElement({});
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    expect(screen.queryByLabelText('Corner radius')).toBeNull();
  });

  it('keeps corner radius for a shape, clamped to the box', () => {
    const { store, el } = withElement({ type: 'shape', shape: 'rect', width: 100, height: 60 });
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    const radius = screen.getByLabelText('Corner radius') as HTMLInputElement;
    expect(radius).toBeTruthy();
    // Half the shorter side — a larger radius is meaningless on the box.
    expect(radius.max).toBe('30');
  });

  it('hides fill on an open path, which can never be filled', () => {
    const { store, el } = withElement({ closed: false });
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    expect(screen.queryByText('Fill')).toBeNull();
  });

  it('offers fill on a closed path', () => {
    const { store, el } = withElement({ closed: true });
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    expect(screen.getByText('Fill')).toBeTruthy();
  });

  it('offers arrowheads once the path has a stroke to shape', () => {
    const { store, el } = withElement({ strokeWidth: 3 });
    render(<ShapeInspector element={el} ids={[el.id]} store={store} />);

    fireEvent.change(screen.getByLabelText('End'), { target: { value: 'arrow' } });

    expect(current(store).strokeStyle?.arrowEnd).toBe('arrow');
  });
});

describe('buildPathElement', () => {
  it('takes the stroke colour from the tool options', () => {
    const el = buildPathElement(
      { nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }], closed: false },
      { stroke: '#DA0402', strokeWidth: 4 }
    );
    expect(el?.stroke).toBe('#DA0402');
    expect(el?.strokeWidth).toBe(4);
  });

  it('falls back to the shared default so a path is never colourless', () => {
    const el = buildPathElement({ nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }], closed: false }, {});
    expect(el?.stroke).toBe(PEN_DEFAULT_STROKE);
  });

  it('only fills a closed path', () => {
    const open = buildPathElement(
      { nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }], closed: false },
      { fill: '#FFFFFF' }
    );
    const closed = buildPathElement(
      { nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true },
      { fill: '#FFFFFF' }
    );
    expect(open?.fill).toBeUndefined();
    expect(closed?.fill).toBe('#FFFFFF');
  });
});
