import { describe, it, expect, vi } from 'vitest';
import { addText } from './add-text';
import { createDesignerStore } from './designer.store';
import { defaultTextBox } from './measure-text';

vi.mock('./fonts', () => ({ ensureFontLoaded: () => Promise.resolve() }));
vi.mock('./measure-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./measure-text')>();
  return { ...actual, defaultTextBox: vi.fn(actual.defaultTextBox) };
});

const videoStore = () => {
  const store = createDesignerStore(1080, 1080);
  store.getState().setMode('video');
  return store;
};

describe('addText — image documents', () => {
  it('adds a text element and selects it', () => {
    const store = createDesignerStore(1000, 1000);
    const id = addText(store);

    const children = store.getState().doc.outputs[0].children;
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('text');
    expect(store.getState().selectedIds).toEqual([id]);
  });

  it('creates generic Text at 400 Normal', () => {
    const store = createDesignerStore(1000, 1000);
    addText(store);
    expect(store.getState().doc.outputs[0].children[0]).toMatchObject({
      text: 'Text', fontWeight: 400, fontStyle: 'normal',
    });
  });

  it('centres the box when no position is given', () => {
    const store = createDesignerStore(1000, 600);
    addText(store);
    const [el] = store.getState().doc.outputs[0].children;
    expect(el.x + el.width / 2).toBeCloseTo(500, 0);
    expect(el.y + el.height / 2).toBeCloseTo(300, 0);
  });

  it('places the box where asked', () => {
    const store = createDesignerStore();
    addText(store, {}, { at: { x: 42, y: 84 } });
    const [el] = store.getState().doc.outputs[0].children;
    expect(el.x).toBe(42);
    expect(el.y).toBe(84);
  });

  it('carries a preset through', () => {
    const store = createDesignerStore();
    addText(store, { name: 'Heading', fontSize: 72, fontWeight: 800, fontFamily: 'Anton' });
    const [el] = store.getState().doc.outputs[0].children;
    expect(el.text).toBe('Heading');
    expect(el.fontSize).toBe(72);
    expect(el.fontFamily).toBe('Anton');
  });

  it.each([
    { width: 540, height: 540, fontSize: 16 },
    { width: 1080, height: 1920, fontSize: 43 },
    { width: 1920, height: 1080, fontSize: 43 },
  ])('scales default text and its box for $width×$height', ({ width, height, fontSize }) => {
    const store = createDesignerStore(width, height);
    addText(store);
    const [el] = store.getState().doc.outputs[0].children;
    expect(el.fontSize).toBe(fontSize);
    expect(el.height).toBe(Math.ceil(fontSize * 1.2));
    expect(el.width).toBeGreaterThan(fontSize);
    expect(el.autoFit).toBe(false);
  });

  it('grows the measured box with the canvas and matches equal type bases', () => {
    const small = createDesignerStore(540, 540);
    const story = createDesignerStore(1080, 1920);
    const landscape = createDesignerStore(1920, 1080);
    addText(small);
    addText(story);
    addText(landscape);
    const smallText = small.getState().doc.outputs[0].children[0];
    const storyText = story.getState().doc.outputs[0].children[0];
    const landscapeText = landscape.getState().doc.outputs[0].children[0];
    expect(storyText.width).toBeGreaterThan(smallText.width * 2);
    expect(storyText.height).toBeGreaterThan(smallText.height * 2);
    expect(landscapeText.width).toBe(storyText.width);
    expect(landscapeText.height).toBe(storyText.height);
  });

  it('scales preset size and tracking from the same type basis', () => {
    const store = createDesignerStore(540, 540);
    addText(store, { fontSize: 72, letterSpacing: -2 });
    const [el] = store.getState().doc.outputs[0].children;
    expect(el.fontSize).toBe(36);
    expect(el.letterSpacing).toBe(-1);
  });

  it('passes the active type scale to new-box padding', () => {
    const store = createDesignerStore(400, 400);
    vi.mocked(defaultTextBox).mockClear();

    addText(store);

    expect(defaultTextBox).toHaveBeenCalledWith(
      expect.objectContaining({ paddingScale: 0.5 })
    );
  });
});

describe('addText — video documents', () => {
  it('creates the text track when the document has none', () => {
    const store = videoStore();
    const vo = () => store.getState().doc.outputs[0] as never as { tracks: { type: string; clips: unknown[] }[] };
    expect(vo().tracks.some((t) => t.type === 'text')).toBe(false);

    addText(store);

    const textTrack = vo().tracks.find((t) => t.type === 'text');
    expect(textTrack).toBeTruthy();
    expect(textTrack?.clips).toHaveLength(1);
    expect(textTrack?.clips[0]).toMatchObject({ fontWeight: 400, fontStyle: 'normal' });
  });

  it('reuses an existing text track rather than stacking new ones', () => {
    const store = videoStore();
    addText(store);
    addText(store);

    const tracks = (store.getState().doc.outputs[0] as never as { tracks: { type: string; clips: unknown[] }[] }).tracks;
    const textTracks = tracks.filter((t) => t.type === 'text');
    expect(textTracks).toHaveLength(1);
    expect(textTracks[0].clips).toHaveLength(2);
  });

  it('starts the clip at the playhead and selects it', () => {
    const store = videoStore();
    store.getState().setPlayhead(2500);

    const id = addText(store);

    const track = (store.getState().doc.outputs[0] as never as {
      tracks: { id: string; type: string; clips: { id: string; startMs: number; endMs: number }[] }[];
    }).tracks.find((t) => t.type === 'text')!;
    const clip = track.clips[0];
    expect(clip.startMs).toBe(2500);
    expect(clip.endMs).toBeGreaterThan(clip.startMs);
    expect(store.getState().selectedClip).toEqual({
      outputIndex: 0,
      trackId: track.id,
      clipId: id,
    });
  });

  it('clamps a playhead sitting past the end of the timeline', () => {
    const store = videoStore();
    const durationMs = (store.getState().doc.outputs[0] as never as { durationMs: number }).durationMs;
    store.getState().setPlayhead(durationMs + 5000);

    addText(store);

    const clip = (store.getState().doc.outputs[0] as never as {
      tracks: { type: string; clips: { startMs: number; endMs: number }[] }[];
    }).tracks.find((t) => t.type === 'text')!.clips[0];
    expect(clip.startMs).toBeLessThanOrEqual(durationMs - 1000);
    expect(clip.endMs).toBeLessThanOrEqual(durationMs);
  });

  it('uses canvas-aware defaults without adding static auto-fit fields', () => {
    const store = createDesignerStore(1080, 1920);
    store.getState().setMode('video');
    addText(store);
    const output = store.getState().doc.outputs[0] as never as {
      tracks: { type: string; clips: { fontSize?: number; autoFit?: boolean }[] }[];
    };
    const clip = output.tracks.find((track) => track.type === 'text')!.clips[0];
    expect(clip.fontSize).toBe(43);
    expect(clip.autoFit).toBeUndefined();
  });

  it('adds no ELEMENT in video mode', () => {
    const store = videoStore();
    addText(store);
    expect((store.getState().doc.outputs[0] as never as { children?: unknown[] }).children).toBeUndefined();
  });
});
