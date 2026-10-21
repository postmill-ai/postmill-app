import { describe, it, expect } from 'vitest';
import { createDesignerStore } from './designer.store';
import type { DesignerElement, VideoOutput } from './designer.store';

/**
 * The history contract the canvas commits rely on: element/clip mutators push
 * history THEMSELVES, exactly once per call. Callers used to push again after
 * them, stacking two identical snapshots per action so Undo took two clicks.
 * If that discipline breaks, the canvas commits go back to double-pushing.
 */

const rect = (over: Partial<DesignerElement> = {}): DesignerElement => ({
  id: '',
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
  ...over,
});

describe('history push discipline', () => {
  it('addElement pushes exactly one entry — one undo removes the element', () => {
    const store = createDesignerStore(1080, 1080);
    const before = store.getState().history.length;

    store.getState().addElement(rect());
    expect(store.getState().history.length).toBe(before + 1);

    store.getState().undo();
    expect(
      (store.getState().doc.outputs[0] as { children: unknown[] }).children
    ).toHaveLength(0);
  });

  it('addClip pushes exactly one entry in a video document', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setMode('video');
    store.getState().addTrack(0, 'shape');
    const track = (store.getState().doc.outputs[0] as VideoOutput).tracks[0];
    const before = store.getState().history.length;

    store.getState().addClip(0, track.id, { id: '', startMs: 0, endMs: 1000 });
    expect(store.getState().history.length).toBe(before + 1);

    store.getState().undo();
    expect(
      (store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips
    ).toHaveLength(0);
  });

  it('updateElement does NOT push — the gesture commits it explicitly', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().addElement(rect());
    const id = store.getState().selectedIds[0];
    const before = store.getState().history.length;

    store.getState().updateElement(id, { x: 42 });
    expect(store.getState().history.length).toBe(before);

    store.getState().pushHistory();
    expect(store.getState().history.length).toBe(before + 1);

    store.getState().undo();
    expect(
      (store.getState().doc.outputs[0] as { children: DesignerElement[] }).children[0].x
    ).toBe(10);
  });
});
