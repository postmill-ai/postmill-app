import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { createDesignerStore, type DesignerElement, type DesignerOutput, type VideoOutput } from './designer.store';
import { TextEditingOverlay } from './text-editing';

const baseEl = (over: Partial<DesignerElement> = {}): DesignerElement => ({
  id: '',
  type: 'shape',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  ...over,
});

describe('4.6 splitClip source trim-in', () => {
  it('offsets the second half so it does not replay the source from 0', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setMode('video');
    const out = store.getState().currentOutput;
    const vo = () => store.getState().doc.outputs[out] as VideoOutput;
    const trackId = vo().tracks[0].id;

    store.getState().addClip(out, trackId, { id: 'c1', startMs: 0, endMs: 4000, src: 'a.mp4' });
    store.getState().splitClip(out, trackId, 'c1', 2000);

    const clips = vo().tracks[0].clips.sort((a, b) => a.startMs - b.startMs);
    expect(clips).toHaveLength(2);
    expect(clips[0].endMs).toBe(2000);
    expect(clips[1].startMs).toBe(2000);
    // No original trimIn → second half must still advance to the split point.
    expect(clips[1].trimInMs).toBe(2000);
  });

  it('adds the existing trim-in to the split offset', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setMode('video');
    const out = store.getState().currentOutput;
    const vo = () => store.getState().doc.outputs[out] as VideoOutput;
    const trackId = vo().tracks[0].id;

    store.getState().addClip(out, trackId, { id: 'c1', startMs: 0, endMs: 4000, src: 'a.mp4', trimInMs: 500 });
    store.getState().splitClip(out, trackId, 'c1', 2000);

    const clips = vo().tracks[0].clips.sort((a, b) => a.startMs - b.startMs);
    expect(clips[1].trimInMs).toBe(2500); // 500 + (2000 - 0)
  });
});

describe('0.6b reorder preserves every format', () => {
  it('does not destroy other outputs when reordering the current one', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().addElement(baseEl({ id: '' }));
    store.getState().addElement(baseEl({ id: '' }));
    // Second format copies the two linked children.
    store.getState().addOutput({ formatId: 'story', name: 'Story', width: 1080, height: 1920 });

    store.getState().setCurrentOutput(0);
    const children = (store.getState().doc.outputs[0] as DesignerOutput).children;
    expect(children).toHaveLength(2);

    store.getState().reorder([children[0].id], 'forward');

    const outs = store.getState().doc.outputs;
    expect(outs).toHaveLength(2); // BOTH formats survive
    expect((outs[0] as DesignerOutput).children).toHaveLength(2);
    expect((outs[1] as DesignerOutput).children).toHaveLength(2);
  });
});

describe('6.5 undo/redo dirty tracking + delete batching', () => {
  it('clears isDirty when redoing back to the saved state', () => {
    const store = createDesignerStore(1080, 1080);
    expect(store.getState().isDirty).toBe(false);

    store.getState().addElement(baseEl({ id: '' }));
    expect(store.getState().isDirty).toBe(true);

    store.getState().markSaved();
    expect(store.getState().isDirty).toBe(false);

    store.getState().undo();
    expect(store.getState().isDirty).toBe(true); // moved away from the saved snapshot

    store.getState().redo();
    expect(store.getState().isDirty).toBe(false); // back at the saved snapshot
  });

  it('updateElementsSilent does not push history (continuous controls commit on release)', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().addElement(baseEl({ id: '' }));
    const id = (store.getState().doc.outputs[0] as DesignerOutput).children[0].id;
    const before = store.getState().historyIndex;

    store.getState().updateElementsSilent([id], { rotation: 45 });
    expect(store.getState().historyIndex).toBe(before); // no new entry mid-drag
    expect((store.getState().doc.outputs[0] as DesignerOutput).children[0].rotation).toBe(45);

    store.getState().pushHistory(); // release
    expect(store.getState().historyIndex).toBe(before + 1);
  });

  it('removeElements is a single history entry', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().addElement(baseEl({ id: '' }));
    store.getState().addElement(baseEl({ id: '' }));
    const ids = (store.getState().doc.outputs[0] as DesignerOutput).children.map((c) => c.id);
    const before = store.getState().historyIndex;

    store.getState().removeElements(ids);

    expect(store.getState().historyIndex).toBe(before + 1);
    expect((store.getState().doc.outputs[0] as DesignerOutput).children).toHaveLength(0);
  });
});

describe('4.2 text editor escapes stored HTML', () => {
  it('renders <img onerror> as escaped text, not an element', () => {
    const el = baseEl({ id: 't1', type: 'text', text: '<img src=x onerror=alert(1)>' });
    const { container } = render(
      <TextEditingOverlay
        element={el}
        stageRect={{ x: 0, y: 0, scale: 1 }}
        onUpdate={() => {}}
        onComplete={() => {}}
      />
    );
    // No injected element executes; the payload is present only as escaped text.
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    cleanup();
  });
});
