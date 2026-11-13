import { describe, expect, it, vi } from 'vitest';
import { combineElements, layerActions } from './layer-actions';
import { createDesignerStore, type DesignerElement } from './designer.store';

const shape = (id: string, x = 0, width = 100): DesignerElement => ({
  id,
  type: 'shape',
  shape: 'rect',
  x,
  y: 0,
  width,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  fill: '#ff0000',
});

const storeWith = (...elements: DesignerElement[]) => {
  const store = createDesignerStore();
  for (const element of elements) store.getState().addElement(element);
  return store;
};

describe('multi-shape Pathfinder document edits', () => {
  it('unites three shapes in one history entry and restores all inputs with one Undo', () => {
    const store = storeWith(shape('a', 0), shape('b', 50), shape('c', 100));
    const before = store.getState().doc.outputs[0].children;
    const historyBefore = store.getState().history.length;

    combineElements(store, before, 'unite');

    expect(store.getState().doc.outputs[0].children).toHaveLength(1);
    expect(store.getState().doc.outputs[0].children[0].id).toBe('a');
    expect(store.getState().selectedIds).toEqual(['a']);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children.map((element) => element.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves disjoint results and selects every resulting layer', () => {
    const store = storeWith(shape('a', 0), shape('b', 200));
    const historyBefore = store.getState().history.length;

    combineElements(store, store.getState().doc.outputs[0].children, 'unite');

    expect(store.getState().doc.outputs[0].children).toHaveLength(2);
    expect(store.getState().selectedIds).toHaveLength(2);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
  });

  it('stores a contained subtraction as one compound path and restores inputs with one Undo', () => {
    const store = storeWith(shape('a', 0, 200), { ...shape('inner', 50, 100), y: 20, height: 60 });
    const before = store.getState().doc.outputs[0].children;
    const historyBefore = store.getState().history.length;

    expect(combineElements(store, before, 'subtract')).toBe(true);

    const result = store.getState().doc.outputs[0].children;
    expect(result).toHaveLength(1);
    expect(result[0].fillRule).toBe('evenodd');
    expect(result[0].subpaths).toHaveLength(2);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children).toEqual(before);
  });

  it('rejects frozen output writes without selection or history changes', () => {
    const store = storeWith(shape('a', 0), shape('b', 50));
    const elements = store.getState().doc.outputs[0].children;
    store.getState().setOutputFrozen(0, true);
    const before = store.getState().doc;
    const selection = store.getState().selectedIds;
    const historyLength = store.getState().history.length;

    expect(combineElements(store, elements, 'unite')).toBe(false);

    expect(store.getState().doc).toBe(before);
    expect(store.getState().selectedIds).toBe(selection);
    expect(store.getState().history).toHaveLength(historyLength);
  });

  it('reports an empty operation through the action failure callback', () => {
    const store = storeWith(shape('a', 0), { ...shape('inner', 200, 20), y: 200, height: 20 });
    const before = store.getState().doc.outputs[0].children;
    const onFailure = vi.fn();
    const actions = layerActions(store, () => ({
      selectedEls: before,
      hasSelection: true,
      children: before,
    }), onFailure);

    actions.find((action) => action.id === 'pathfinder-intersect')!.run();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(store.getState().doc.outputs[0].children).toEqual(before);
  });
});
