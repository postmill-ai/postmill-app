import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignerStore } from '../designer.store';
import {
  applyDesignerSuggestionAction,
  captureDesignerSuggestionScope,
  designerSuggestionActionStatus,
  designerSuggestionSelection,
} from './designer-assistant-actions';

const textElement = (id: string, x: number, y: number) => ({
  id,
  type: 'text' as const,
  text: id,
  x,
  y,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

const setup = () => {
  const store = createDesignerStore();
  store.getState().addElement(textElement('one', 100, 100));
  store.getState().addElement(textElement('two', 300, 300));
  store.getState().addElement(textElement('three', 900, 500));
  store.getState().setSelectedIds(['one']);
  return store;
};

const children = (store: ReturnType<typeof createDesignerStore>) =>
  (store.getState().doc.outputs[0] as any).children;

describe('designer assistant actions', () => {
  let store: ReturnType<typeof createDesignerStore>;

  beforeEach(() => {
    store = setup();
  });

  it('aligns one element to the canvas with one undoable edit', () => {
    const output = store.getState().doc.outputs[0];
    const before = store.getState().historyIndex;
    const scope = captureDesignerSuggestionScope(store);

    expect(applyDesignerSuggestionAction(store, { type: 'align', position: 'center' }, scope)).toBe('ready');
    expect(children(store)[0].x).toBe(Math.round((output.width - 100) / 2));
    expect(store.getState().historyIndex).toBe(before + 1);

    store.getState().undo();
    expect(children(store)[0].x).toBe(100);
  });

  it('aligns a multi-selection to its own bounds', () => {
    store.getState().setSelectedIds(['one', 'two']);
    const scope = captureDesignerSuggestionScope(store);

    expect(applyDesignerSuggestionAction(store, { type: 'align', position: 'left' }, scope)).toBe('ready');
    expect(children(store).slice(0, 2).map((element: any) => element.x)).toEqual([100, 100]);
    expect(children(store)[2].x).toBe(900);
  });

  it('uses the shared equal-gap distribution for three elements', () => {
    store.getState().setSelectedIds(['one', 'two', 'three']);
    const scope = captureDesignerSuggestionScope(store);

    expect(applyDesignerSuggestionAction(store, { type: 'distribute', mode: 'horizontal-gaps' }, scope)).toBe('ready');
    expect(children(store).map((element: any) => element.x)).toEqual([100, 500, 900]);
  });

  it('requires three selected elements for distribution', () => {
    store.getState().setSelectedIds(['one', 'two']);
    const scope = captureDesignerSuggestionScope(store);
    const before = store.getState().doc;

    expect(applyDesignerSuggestionAction(store, { type: 'distribute', mode: 'vertical-gaps' }, scope)).toBe('needs-three');
    expect(store.getState().doc).toBe(before);
  });

  it('rejects a stale selection without changing the document', () => {
    const scope = captureDesignerSuggestionScope(store);
    store.getState().setSelectedIds(['two']);
    const before = store.getState().doc;

    expect(applyDesignerSuggestionAction(store, { type: 'align', position: 'right' }, scope)).toBe('stale');
    expect(store.getState().doc).toBe(before);
  });

  it('rejects an action when its originating output no longer exists', () => {
    const scope = captureDesignerSuggestionScope(store);
    store.setState((state) => ({ doc: { ...state.doc, outputs: [] } }));

    expect(applyDesignerSuggestionAction(store, { type: 'align', position: 'center' }, scope)).toBe('stale');
  });

  it('does not offer static layout actions in video mode', () => {
    store.setState((state) => ({ doc: { ...state.doc, mode: 'video' as const } }));
    const scope = captureDesignerSuggestionScope(store);

    expect(designerSuggestionActionStatus(store, { type: 'align', position: 'center' }, scope)).toBe('unsupported');
  });

  it('treats a missing document mode as a legacy image design', () => {
    store.setState((state) => ({ doc: { ...state.doc, mode: undefined } }));
    const scope = captureDesignerSuggestionScope(store);

    expect(designerSuggestionActionStatus(store, { type: 'align', position: 'center' }, scope)).toBe('ready');
  });

  it('serializes only bounded selection geometry for the request', () => {
    expect(designerSuggestionSelection(store)).toEqual([
      { type: 'text', x: 100, y: 100, width: 100, height: 50 },
    ]);
  });

  it('caps serialized selection context at fifty elements', () => {
    for (let index = 4; index <= 51; index++) {
      store.getState().addElement(textElement(`extra-${index}`, index * 10, 0));
    }
    store.getState().setSelectedIds(children(store).map((element: any) => element.id));

    expect(designerSuggestionSelection(store)).toHaveLength(50);
  });
});
