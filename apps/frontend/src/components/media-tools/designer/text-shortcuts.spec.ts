import { describe, expect, it, vi } from 'vitest';
import { MAX_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { adjustSelectedTextFontSize, fontSizeShortcutDelta } from './text-shortcuts';
import { createDesignerStore, type DesignerElement, type DesignerOutput, type VideoOutput } from './designer.store';

vi.mock('./fonts', () => ({
  DESIGNER_FONTS: [],
  ensureFontLoaded: () => Promise.resolve(),
}));
vi.mock('./measure-text', () => ({
  fittedFontSize: (element: DesignerElement) =>
    element.text === 'fitted' ? 29 : element.fontSize ?? 16,
  growBoxFor: (element: DesignerElement, fontSize: number) =>
    element.richText?.length ? {} : { height: Math.ceil(fontSize * 1.2) },
}));

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

    expect(adjustSelectedTextFontSize(store, 1)).toBe(true);
    expect(store.getState().history).toHaveLength(history + 1);
    for (const output of [0, 1]) {
      expect(children(store, output).map((element) => element.fontSize)).toEqual([33, 33]);
      expect(children(store, output).map((element) => element.width)).toEqual([100, 100]);
    }
    expect(children(store, 0).map((element) => element.height)).toEqual([40, 40]);
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

    adjustSelectedTextFontSize(store, -1);
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
    expect(adjustSelectedTextFontSize(store, -1)).toBe(false);
    store.getState().setSelectedIds(['maximum']);
    expect(adjustSelectedTextFontSize(store, 1)).toBe(false);
    expect(store.getState().history).toHaveLength(history);
  });

  it('grows an unshrunk default box on each increase instead of stepping down', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('default', { height: 39 }));
    store.getState().setSelectedIds(['default']);

    expect(adjustSelectedTextFontSize(store, 1)).toBe(true);
    expect(children(store)[0]).toMatchObject({ fontSize: 33, height: 40 });
    expect(adjustSelectedTextFontSize(store, 1)).toBe(true);
    expect(children(store)[0]).toMatchObject({ fontSize: 34, height: 41 });
  });

  it('starts from the fitted size and leaves the existing box unchanged', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('fit', {
      text: 'fitted', fontSize: 48, width: 200, height: 40,
    }));
    store.getState().setSelectedIds(['fit']);

    expect(adjustSelectedTextFontSize(store, -1)).toBe(true);
    expect(children(store)[0]).toMatchObject({ fontSize: 28, width: 200, height: 40 });
  });

  it('adjusts mixed rich-text runs independently without flattening them', () => {
    const store = createDesignerStore();
    store.getState().addElement(textElement('rich', {
      fontSize: 16,
      richText: [{ text: 'small', fontSize: 20 }, { text: ' large', fontSize: 40 }],
    }));
    store.getState().setSelectedIds(['rich']);

    expect(adjustSelectedTextFontSize(store, 1)).toBe(true);
    expect(children(store)[0].fontSize).toBe(17);
    expect(children(store)[0].richText?.map((run) => run.fontSize)).toEqual([21, 41]);
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

  it('uses the caption renderer fallback of 28 for an unset size', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().addTrack(0, 'caption');
    const output = store.getState().doc.outputs[0] as VideoOutput;
    const track = output.tracks.find((item) => item.type === 'caption')!;
    store.getState().addClip(0, track.id, {
      id: 'caption', startMs: 0, endMs: 1000, text: 'Caption',
    });
    store.getState().setSelectedClip({ outputIndex: 0, trackId: track.id, clipId: 'caption' });

    expect(adjustSelectedTextFontSize(store, 1)).toBe(true);
    const next = store.getState().doc.outputs[0] as VideoOutput;
    expect(next.tracks.find((item) => item.id === track.id)?.clips[0].fontSize).toBe(29);
  });
});

describe('fontSizeShortcutDelta', () => {
  const modifiers = { ctrlKey: true, metaKey: false, altKey: false };

  it('retains punctuation shortcuts and accepts physical codes only with Shift', () => {
    expect(fontSizeShortcutDelta({ ...modifiers, key: '>', code: 'Period' })).toBe(1);
    expect(fontSizeShortcutDelta({ ...modifiers, key: '<', code: 'Comma' })).toBe(-1);
    expect(fontSizeShortcutDelta({ ...modifiers, key: '.', code: 'Period' })).toBe(0);
    expect(fontSizeShortcutDelta({ ...modifiers, key: ',', code: 'Comma' })).toBe(0);
    expect(fontSizeShortcutDelta({ ...modifiers, shiftKey: true, key: '.', code: 'Period' })).toBe(1);
    expect(fontSizeShortcutDelta({ ...modifiers, shiftKey: true, key: ',', code: 'Comma' })).toBe(-1);
  });

  it('does not turn Dvorak paste or other letter shortcuts into font-size edits', () => {
    expect(fontSizeShortcutDelta({ ...modifiers, key: 'v', code: 'Period' })).toBe(0);
    expect(fontSizeShortcutDelta({ ...modifiers, shiftKey: true, key: 'V', code: 'Period' })).toBe(0);
  });

  it('supports an unshifted ISO less-than key and ignores unmodified keys', () => {
    expect(fontSizeShortcutDelta({ ...modifiers, key: '<', code: 'IntlBackslash' })).toBe(-1);
    expect(fontSizeShortcutDelta({ ...modifiers, ctrlKey: false, key: '<', code: 'IntlBackslash' })).toBe(0);
  });
});
