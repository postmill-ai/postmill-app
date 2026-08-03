import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { TemplateFillPanel } from './panels/template-fill-panel';
import { createDesignerStore, type DesignerElement } from './designer.store';

/**
 * Symbols as a document edit, and the template form.
 *
 * The store side is what turns a selection into something reusable; getting the
 * coordinate re-basing wrong there is what makes an instance jump when it is
 * placed a second time.
 */

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

vi.mock('../use-media-picker', () => ({
  useMediaPicker: () => ({
    open: () => {},
    openWith: () => {},
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

afterEach(cleanup);

const el = (over: Partial<DesignerElement>): DesignerElement =>
  ({
    id: '',
    type: 'shape',
    shape: 'rect',
    x: 0, y: 0, width: 50, height: 50,
    rotation: 0, opacity: 1, locked: false, hidden: false,
    ...over,
  }) as DesignerElement;

const children = (store: ReturnType<typeof createDesignerStore>) =>
  store.getState().doc.outputs[0].children as DesignerElement[];

describe('createSymbol', () => {
  const withTwo = () => {
    const store = createDesignerStore(1000, 1000);
    store.getState().addElement(el({ x: 100, y: 100 }));
    store.getState().addElement(el({ x: 200, y: 160, width: 40, height: 40 }));
    store.getState().setSelectedIds(children(store).map((c) => c.id));
    return store;
  };

  it('replaces the selection with a single instance', () => {
    const store = withTwo();
    store.getState().createSymbol('Lockup');

    expect(children(store)).toHaveLength(1);
    expect(children(store)[0].type).toBe('symbol');
  });

  it('sizes the instance to the selection’s bounds', () => {
    const store = withTwo();
    store.getState().createSymbol();

    const instance = children(store)[0];
    expect(instance.x).toBe(100);
    expect(instance.y).toBe(100);
    expect(instance.width).toBe(140); // x spans 100…240
    expect(instance.height).toBe(100); // y spans 100…200
  });

  it('stores the definition in the definition’s OWN coordinate space', () => {
    // Otherwise a second instance placed elsewhere renders at the first one's
    // position.
    const store = withTwo();
    store.getState().createSymbol();

    const def = store.getState().doc.symbols![0];
    expect(Math.min(...def.children.map((c) => c.x))).toBe(0);
    expect(Math.min(...def.children.map((c) => c.y))).toBe(0);
  });

  it('selects the new instance', () => {
    const store = withTwo();
    store.getState().createSymbol();
    expect(store.getState().selectedIds).toEqual([children(store)[0].id]);
  });

  it('records a named history entry', () => {
    const store = withTwo();
    store.getState().createSymbol();
    const labels = store.getState().historyLabels;
    expect(labels[labels.length - 1]).toBe('Create symbol');
  });

  it('does nothing with an empty selection', () => {
    const store = createDesignerStore();
    store.getState().createSymbol();
    expect(store.getState().doc.symbols).toBeUndefined();
  });
});

describe('placeSymbol', () => {
  it('adds another instance of the same definition', () => {
    const store = createDesignerStore(1000, 1000);
    store.getState().addElement(el({ x: 100, y: 100 }));
    store.getState().setSelectedIds([children(store)[0].id]);
    store.getState().createSymbol('Lockup');

    const symbolId = store.getState().doc.symbols![0].id;
    store.getState().placeSymbol(symbolId);

    const instances = children(store).filter((c) => c.type === 'symbol');
    expect(instances).toHaveLength(2);
    expect(instances[1].symbolId).toBe(symbolId);
    // Centred on the artboard, like every other insert.
    expect(instances[1].x).toBe(Math.round((1000 - instances[1].width) / 2));
  });

  it('ignores an id that is not a symbol', () => {
    const store = createDesignerStore();
    store.getState().placeSymbol('nope');
    expect(children(store)).toHaveLength(0);
  });
});

describe('updateSymbolDefinition', () => {
  it('changes the definition, so every instance follows', () => {
    const store = createDesignerStore(1000, 1000);
    store.getState().addElement(el({ x: 0, y: 0, fill: '#000000' }));
    store.getState().setSelectedIds([children(store)[0].id]);
    store.getState().createSymbol();

    const symbolId = store.getState().doc.symbols![0].id;
    store.getState().placeSymbol(symbolId);

    store
      .getState()
      .updateSymbolDefinition(symbolId, [
        { ...store.getState().doc.symbols![0].children[0], fill: '#ff0000' },
      ]);

    expect(store.getState().doc.symbols![0].children[0].fill).toBe('#ff0000');
    // Both instances still point at the one definition.
    expect(children(store).filter((c) => c.type === 'symbol')).toHaveLength(2);
  });

  it('ignores an unknown symbol id', () => {
    const store = createDesignerStore();
    store.getState().updateSymbolDefinition('nope', []);
    expect(store.getState().doc.symbols).toBeUndefined();
  });
});

describe('TemplateFillPanel', () => {
  const withSlots = () => {
    const store = createDesignerStore();
    store.getState().addElement(
      el({ type: 'text', text: 'Hello', slot: { name: 'Headline', kind: 'text' } })
    );
    return store;
  };

  it('says what to do when nothing is slotted', () => {
    render(<TemplateFillPanel store={createDesignerStore()} />);
    expect(screen.getByText(/Mark a layer as a template slot/)).toBeTruthy();
  });

  it('renders one field per slot, labelled by the author', () => {
    render(<TemplateFillPanel store={withSlots()} />);
    expect(screen.getByText('Headline')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Hello');
  });

  it('writes straight through to the element', () => {
    const store = withSlots();
    render(<TemplateFillPanel store={store} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
    expect(children(store)[0].text).toBe('Changed');
  });
});
