import { describe, expect, it } from 'vitest';
import { createDesignerStore, type VideoOutput } from './designer.store';

const setup = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const output = store.getState().doc.outputs[0] as VideoOutput;
  const trackId = output.tracks[0].id;
  store.getState().addClip(0, trackId, { id: 'clip', startMs: 200, endMs: 2200 });
  store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'clip' });
  return { store, trackId };
};

describe('splitClip guards', () => {
  it.each([0, 200, 250, 2150, 2200, 5000])('does not split or write history outside the valid interior (%sms)', (atMs) => {
    const { store, trackId } = setup();
    const before = store.getState().doc;
    const history = store.getState().history.length;
    store.getState().splitClip(0, trackId, 'clip', atMs);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(history);
    expect(store.getState().selectedClip?.clipId).toBe('clip');
  });

  it('selects the right half after a valid split', () => {
    const { store, trackId } = setup();
    store.getState().splitClip(0, trackId, 'clip', 1000);
    const output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks[0].clips.map((clip) => [clip.startMs, clip.endMs])).toEqual([
      [200, 1000], [1000, 2200],
    ]);
    expect(store.getState().selectedClip?.clipId).toBe(output.tracks[0].clips[1].id);
    expect(store.getState().selectedClips).toEqual([
      { trackId, clipId: output.tracks[0].clips[1].id },
    ]);
  });
});
