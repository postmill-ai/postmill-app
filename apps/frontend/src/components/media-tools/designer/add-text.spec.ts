import { describe, it, expect, vi } from 'vitest';
import { addText } from './add-text';
import { createDesignerStore } from './designer.store';

vi.mock('./fonts', () => ({ ensureFontLoaded: () => Promise.resolve() }));

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

  it('adds no ELEMENT in video mode', () => {
    const store = videoStore();
    addText(store);
    expect((store.getState().doc.outputs[0] as never as { children?: unknown[] }).children).toBeUndefined();
  });
});
