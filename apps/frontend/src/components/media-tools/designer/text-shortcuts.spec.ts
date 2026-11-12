import { describe, expect, it, vi } from 'vitest';
import { MAX_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { MeasureText } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import { adjustSelectedTextFontSize } from './text-shortcuts';
import { createDesignerStore, type DesignerElement, type DesignerOutput, type VideoOutput } from './designer.store';

vi.mock('./fonts', () => ({
  DESIGNER_FONTS: [],
  ensureFontLoaded: () => Promise.resolve(),
}));

const measure: MeasureText = (text, size) => text.length * size * 0.5;

const textElement = (id: string, over: Partial<DesignerElement> = {}): DesignerElement => ({
  id,
  type: 'text',
  text: 'hello world',
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  fontFamily: 'Arial',
  fontSize: 32,
  ...over,
});

const children = (store: ReturnType<typeof createDesignerStore>, output = 0) =>
  (store.getState().doc.outputs[output] as DesignerOutput).children;

describe('adjustSelectedTextFontSize', () => {
  it('updates a static multi-selection and linked formats with one history entry', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('one'));
    store.getState().addElement(textElement('two'));
    store.getState().addOutput({ formatId: 'square', name: 'Square 2', width: 1080, height: 1080 });
    store.getState().setCurrentOutput(0);
    store.getState().setSelectedIds(['one', 'two']);
    const history = store.getState().history.length;

    expect(adjustSelectedTextFontSize(store, 1, measure)).toBe(true);
    expect(store.getState().history).toHaveLength(history + 1);
    for (const output of [0, 1]) {
      expect(children(store, output).map((element) => element.fontSize)).toEqual([33, 33]);
      expect(children(store, output).map((element) => element.width)).toEqual([100, 100]);
    }
    expect(children(store, 0).map((element) => element.height)).toEqual([80, 80]);
    // Box geometry remains format-local when the font edit propagates.
    expect(children(store, 1).map((element) => element.height)).toEqual([20, 20]);

    store.getState().undo();
    expect(children(store, 0).map((element) => element.fontSize)).toEqual([32, 32]);
    expect(children(store, 1).map((element) => element.fontSize)).toEqual([32, 32]);
  });

  it('keeps mixed and locked selections out of the edit and does not shrink manual boxes', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('editable', { height: 200 }));
    store.getState().addElement(textElement('locked', { locked: true }));
    store.getState().addElement({
      ...textElement('shape'),
      type: 'shape',
      text: undefined,
    });
    store.getState().setSelectedIds(['editable', 'locked', 'shape']);

    adjustSelectedTextFontSize(store, -1, measure);
    expect(children(store)[0]).toMatchObject({ fontSize: 31, height: 200 });
    expect(children(store)[1].fontSize).toBe(32);
    expect(children(store)[2].fontSize).toBe(32);
  });

  it('does not add history at the shared font-size bounds', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('minimum', { fontSize: 1 }));
    store.getState().addElement(textElement('maximum', { fontSize: MAX_FONT_SIZE }));
    const history = store.getState().history.length;

    store.getState().setSelectedIds(['minimum']);
    expect(adjustSelectedTextFontSize(store, -1, measure)).toBe(false);
    store.getState().setSelectedIds(['maximum']);
    expect(adjustSelectedTextFontSize(store, 1, measure)).toBe(false);
    expect(store.getState().history).toHaveLength(history);
  });

  it('updates selected video text and caption clips together with one Undo', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'text');
    store.getState().addTrack(0, 'caption');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const textTrack = output.tracks.find((track) => track.type === 'text')!;
    const captionTrack = output.tracks.find((track) => track.type === 'caption')!;
    store.getState().addClip(0, textTrack.id, {
      id: 'text', startMs: 0, endMs: 1000, text: 'Text', fontSize: 20,
    });
    store.getState().addClip(0, captionTrack.id, {
      id: 'caption', startMs: 0, endMs: 1000, text: 'Caption', fontSize: 40,
    });
    store.getState().setSelectedClips([
      { trackId: textTrack.id, clipId: 'text' },
      { trackId: captionTrack.id, clipId: 'caption' },
    ]);
    const history = store.getState().history.length;

    expect(adjustSelectedTextFontSize(store, 1)).toBe(true);
    const next = store.getState().doc.outputs[0] as VideoOutput;
    expect(next.tracks.find((track) => track.id === textTrack.id)?.clips[0].fontSize).toBe(21);
    expect(next.tracks.find((track) => track.id === captionTrack.id)?.clips[0].fontSize).toBe(41);
    expect(store.getState().history).toHaveLength(history + 1);

    store.getState().undo();
    const restored = store.getState().doc.outputs[0] as VideoOutput;
    expect(restored.tracks.find((track) => track.id === textTrack.id)?.clips[0].fontSize).toBe(20);
    expect(restored.tracks.find((track) => track.id === captionTrack.id)?.clips[0].fontSize).toBe(40);
  });
});
