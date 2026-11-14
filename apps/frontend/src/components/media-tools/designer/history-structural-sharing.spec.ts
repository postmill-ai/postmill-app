import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDesignerStore,
  type DesignerDoc,
  type DesignerElement,
  type VideoOutput,
} from './designer.store';

const rect = (id: string): DesignerElement => ({
  id,
  type: 'shape',
  shape: 'rect',
  x: 10,
  y: 10,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  styles: [
    {
      type: 'drop-shadow',
      color: '#000000',
      opacity: 1,
      distance: 4,
      angle: 45,
      size: 8,
      spread: 0,
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structurally shared history', () => {
  it('keeps snapshots isolated from later edits and shares unchanged branches', () => {
    const store = createDesignerStore();
    store.getState().addElement(rect('shape-1'));
    store.getState().updateElement('shape-1', { x: 42 });
    store.getState().pushHistory('Move');
    const movedDoc = store.getState().doc;
    const movedIndex = store.getState().historyIndex;
    const movedStyles = movedDoc.outputs[0].children[0].styles;

    store.getState().updateElement('shape-1', { y: 80 });
    store.getState().pushHistory('Move again');

    expect(store.getState().history[movedIndex]).toBe(movedDoc);
    expect(movedDoc.outputs[0].children[0]).toMatchObject({ x: 42, y: 10 });
    expect(store.getState().history[movedIndex + 1].outputs[0].children[0].styles).toBe(movedStyles);
    expect(store.getState().history[movedIndex + 1].outputs[0].children[0].shape).toBe('rect');

    store.getState().undo();
    expect(store.getState().doc).toBe(movedDoc);
    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({ x: 42, y: 10 });
    store.getState().redo();
    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({ x: 42, y: 80 });
  });

  it('does not serialize documents while pushing, undoing, redoing, or jumping', () => {
    const store = createDesignerStore();
    store.getState().addElement(rect('shape-1'));
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');

    store.getState().updateElement('shape-1', { x: 42 });
    store.getState().pushHistory();
    store.getState().undo();
    store.getState().redo();
    store.getState().jumpToHistory(0);

    expect(stringify).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('invalidates a saved index discarded by a new edit branch', () => {
    const store = createDesignerStore();
    store.getState().addElement(rect('shape-1'));
    store.getState().addElement(rect('shape-2'));
    store.getState().markSaved();
    expect(store.getState().savedHistoryIndex).toBe(2);

    store.getState().undo();
    store.getState().updateElement('shape-1', { x: 99 });
    store.getState().pushHistory('Replace redo branch');

    expect(store.getState().savedHistoryIndex).toBe(-1);
    store.getState().undo();
    expect(store.getState().isDirty).toBe(true);
    store.getState().redo();
    expect(store.getState().isDirty).toBe(true);
  });

  it('marks a saved index as evicted when the history cap drops it', () => {
    const store = createDesignerStore();
    store.getState().markSaved();
    for (let i = 0; i < 51; i++) {
      store.getState().addElement(rect(`shape-${i}`));
    }

    expect(store.getState().history).toHaveLength(50);
    expect(store.getState().savedHistoryIndex).toBe(-1);
    store.getState().undo();
    expect(store.getState().isDirty).toBe(true);
  });

  it('replaces the current history snapshot without changing history identity', () => {
    const store = createDesignerStore();
    store.getState().addElement(rect('shape-1'));
    const sentDoc = store.getState().doc;
    const history = store.getState().history;
    const persistedDoc = {
      ...sentDoc,
      outputs: sentDoc.outputs.map((output, index) =>
        index === 0 ? { ...output, name: 'Materialized' } : output
      ),
    } as DesignerDoc;

    expect(store.getState().adoptPersistedDoc(sentDoc, persistedDoc)).toBe(true);
    store.getState().markSaved();
    const adopted = store.getState().doc;
    expect(store.getState().history).toBe(history);
    expect(store.getState().history[store.getState().historyIndex]).toBe(adopted);

    store.getState().updateElement('shape-1', { x: 100 });
    store.getState().pushHistory();
    store.getState().undo();
    expect(store.getState().doc).toBe(adopted);
    expect(store.getState().doc.outputs[0].name).toBe('Materialized');
    expect(store.getState().isDirty).toBe(false);
  });

  it('preserves the pre-edit snapshot when adoption lands during a silent edit', () => {
    const store = createDesignerStore();
    store.getState().addElement(rect('shape-1'));
    const beforeEdit = store.getState().doc;
    const history = store.getState().history;
    store.getState().updateElementsSilent(['shape-1'], { x: 40 });
    const sentDoc = store.getState().doc;
    const persistedDoc = {
      ...sentDoc,
      outputs: sentDoc.outputs.map((output, index) =>
        index === 0 ? { ...output, name: 'Materialized during edit' } : output
      ),
    } as DesignerDoc;

    expect(store.getState().adoptPersistedDoc(sentDoc, persistedDoc)).toBe(true);
    expect(store.getState().history).toBe(history);
    expect(store.getState().history[store.getState().historyIndex]).toBe(beforeEdit);
    store.getState().markSaved();
    expect(store.getState().savedHistoryIndex).toBe(-1);
    store.getState().pushHistory('Finish silent edit');
    expect(store.getState().savedHistoryIndex).toBe(store.getState().historyIndex);
    store.getState().undo();

    expect(store.getState().doc).toBe(beforeEdit);
    expect(store.getState().doc.outputs[0].children[0].x).toBe(10);
    expect(store.getState().doc.outputs[0].name).not.toBe('Materialized during edit');
    expect(store.getState().isDirty).toBe(true);
    store.getState().redo();
    expect(store.getState().isDirty).toBe(false);
  });

  it('keeps video clip snapshots immutable across silent gesture writes', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    store.getState().addClip(0, output.tracks[0].id, {
      id: 'clip-1',
      startMs: 0,
      endMs: 5000,
      src: '/uploads/video.mp4',
    });
    store.getState().updateClipSilent(0, output.tracks[0].id, 'clip-1', { x: 20 });
    store.getState().pushHistory('Move clip');
    const firstMove = store.getState().doc;

    store.getState().updateClipSilent(0, output.tracks[0].id, 'clip-1', { x: 60 });
    store.getState().pushHistory('Move clip again');

    const firstClip = (firstMove.outputs[0] as VideoOutput).tracks[0].clips[0];
    expect(firstClip.x).toBe(20);
    store.getState().undo();
    expect(store.getState().doc).toBe(firstMove);
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips[0].x).toBe(20);
  });
});
