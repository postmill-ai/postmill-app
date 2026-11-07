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

  it('makes no partial edit when the result requires an unsupported hole', () => {
    const store = storeWith(shape('a', 0), { ...shape('inner', 20, 20), y: 20, height: 20 });
    const before = store.getState().doc.outputs[0].children;
    const historyBefore = store.getState().history.length;

    expect(combineElements(store, before, 'subtract')).toBe(false);

    expect(store.getState().doc.outputs[0].children).toEqual(before);
    expect(store.getState().history).toHaveLength(historyBefore);
  });

  it('reports an unsupported operation through the action failure callback', () => {
    const store = storeWith(shape('a', 0), { ...shape('inner', 20, 20), y: 20, height: 20 });
    const before = store.getState().doc.outputs[0].children;
    const onFailure = vi.fn();
    const actions = layerActions(store, () => ({
      selectedEls: before,
      hasSelection: true,
      children: before,
    }), onFailure);

    actions.find((action) => action.id === 'pathfinder-subtract')!.run();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(store.getState().doc.outputs[0].children).toEqual(before);
  });
});
