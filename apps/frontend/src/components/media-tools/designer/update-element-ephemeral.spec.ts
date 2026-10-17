import { describe, it, expect } from 'vitest';
import { createDesignerStore, type DesignerOutput } from './designer.store';

/**
 * Gesture write isolation (updateElementEphemeral).
 *
 * Drag/transform move events write per rAF frame; routing those through
 * updateElement re-ran applyLinked across every output (and churned
 * linkedUpdateFlash) on each frame. The ephemeral path patches only the
 * current output; dragEnd/transformEnd re-commit via updateElement +
 * pushHistory, so the gesture still lands as ONE history entry with the
 * linked outputs updated exactly once, and the final doc is byte-identical
 * to the plain updateElement path.
 */

const textElement = () => ({
  id: '',
  type: 'text',
  text: 'Headline',
  fontFamily: 'Arial',
  fontSize: 32,
  x: 10,
  y: 10,
  width: 200,
  height: 60,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

const setupLinkedDoc = () => {
  const store = createDesignerStore(1080, 1080);
  store.getState().addElement(textElement() as never);
  store.getState().addOutput({ formatId: 'x-post', name: 'X Post', width: 1600, height: 900 });
  store.getState().setCurrentOutput(0);
  return store;
};

describe('updateElementEphemeral', () => {
  it('patches only the current output per frame — no history, no flash — and the commit lands one entry with linked outputs updated once', () => {
    const store = setupLinkedDoc();
    const id = (store.getState().doc.outputs[0] as DesignerOutput).children[0].id;
    const linkedBefore = (store.getState().doc.outputs[1] as DesignerOutput).children[0];
    const historyBefore = store.getState().history.length;
    const flashBefore = store.getState().linkedUpdateFlash;

    // Drag/transform frames: geometry plus a non-geometry key (fontSize
    // propagates to linked copies under applyLinked, geometry never does).
    store.getState().updateElementEphemeral(id, { x: 20, y: 20 });
    store.getState().updateElementEphemeral(id, { x: 30, y: 30, fontSize: 40 });

    const mid = store.getState();
    const midCurrent = (mid.doc.outputs[0] as DesignerOutput).children[0];
    const midLinked = (mid.doc.outputs[1] as DesignerOutput).children[0];
    expect(midCurrent.x).toBe(30);
    expect(midCurrent.fontSize).toBe(40);
    // The linked copy is untouched mid-gesture…
    expect(midLinked.fontSize).toBe(linkedBefore.fontSize);
    // …no history entries accumulate per frame…
    expect(mid.history.length).toBe(historyBefore);
    // …the flash map is not churned…
    expect(mid.linkedUpdateFlash).toBe(flashBefore);
    // …and the write still marks the doc dirty, like updateElement.
    expect(mid.isDirty).toBe(true);

    // Commit: the normal path, once, plus the gesture's single history entry.
    store.getState().updateElement(id, { x: 30, y: 30, fontSize: 40 });
    store.getState().pushHistory();

    const after = store.getState();
    const linkedAfter = (after.doc.outputs[1] as DesignerOutput).children[0];
    expect(after.history.length).toBe(historyBefore + 1);
    expect(linkedAfter.fontSize).not.toBe(linkedBefore.fontSize);
    expect(after.linkedUpdateFlash[1]).toBeTypeOf('number');
  });

  it('produces exactly the same final doc as the plain updateElement path', () => {
    const store = setupLinkedDoc();
    const id = (store.getState().doc.outputs[0] as DesignerOutput).children[0].id;

    // Gesture path: ephemeral frames, then one commit + history push.
    store.getState().updateElementEphemeral(id, { x: 20, y: 20 });
    store.getState().updateElementEphemeral(id, { x: 30, y: 30, fontSize: 40 });
    store.getState().updateElement(id, { x: 30, y: 30, fontSize: 40 });
    store.getState().pushHistory();
    const gestureDoc = JSON.stringify(store.getState().doc);

    // Back to the pre-gesture state, then the old path: the same final values
    // written through updateElement directly.
    store.getState().undo();
    store.getState().updateElement(id, { x: 30, y: 30, fontSize: 40 });
    store.getState().pushHistory();

    expect(JSON.stringify(store.getState().doc)).toBe(gestureDoc);
  });

  it('is a no-op in video mode, matching updateElement', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setMode('video');
    const before = store.getState().doc;
    store.getState().updateElementEphemeral('missing', { x: 1 });
    expect(store.getState().doc).toBe(before);
  });
});
