import { describe, expect, it } from 'vitest';
import { createDesignerStore, type VideoClip, type VideoOutput } from './designer.store';
import { commitCaptionClips, freezeFrameAt } from './video-output-actions';

const videoStore = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  const trackId = (store.getState().doc.outputs[0] as VideoOutput).tracks[0].id;
  store.getState().addClip(0, trackId, {
    id: 'source', startMs: 0, endMs: 4000, trimInMs: 250,
    src: 'https://example.com/video.mp4', x: 10, y: 20, width: 640, height: 360,
  });
  return { store, trackId };
};

describe('video output actions', () => {
  it('splits a Freeze Frame with source-time geometry and one undoable commit', () => {
    const { store, trackId } = videoStore();
    store.getState().setPlayhead(1500);
    const historyLength = store.getState().history.length;

    expect(freezeFrameAt(store, 0, trackId, 'source')).toBe(true);

    const output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks[0].clips).toHaveLength(3);
    expect(output.tracks[0].clips[0]).toMatchObject({ startMs: 0, endMs: 1500 });
    expect(output.tracks[0].clips[1]).toMatchObject({
      startMs: 1500, endMs: 3500, speed: 0, trimInMs: 1750,
      x: 10, y: 20, width: 640, height: 360,
    });
    expect(output.tracks[0].clips[2]).toMatchObject({ startMs: 3500, trimInMs: 1750 });
    expect(store.getState().history).toHaveLength(historyLength + 1);

    store.getState().undo();
    expect((store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips).toHaveLength(1);
  });

  it('rejects Freeze Frame on a frozen output without history changes', () => {
    const { store, trackId } = videoStore();
    store.getState().setPlayhead(1500);
    store.getState().setOutputFrozen(0, true);
    const before = store.getState().doc;
    const historyLength = store.getState().history.length;

    expect(freezeFrameAt(store, 0, trackId, 'source')).toBe(false);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyLength);
  });

  it('commits and rejects caption batches through the same guarded action', () => {
    const { store } = videoStore();
    const clips = [{ id: 'caption', startMs: 0, endMs: 1000, text: 'Caption' }] as VideoClip[];
    const historyLength = store.getState().history.length;

    expect(commitCaptionClips(store, 0, clips)).toBe(true);
    let output = store.getState().doc.outputs[0] as VideoOutput;
    expect(output.tracks.find((track) => track.type === 'caption')?.clips[0].text).toBe('Caption');
    expect(store.getState().history).toHaveLength(historyLength + 1);

    store.getState().setOutputFrozen(0, true);
    const before = store.getState().doc;
    const frozenHistoryLength = store.getState().history.length;
    expect(commitCaptionClips(store, 0, [{ ...clips[0], id: 'blocked', text: 'Blocked' }])).toBe(false);
    output = store.getState().doc.outputs[0] as VideoOutput;
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(frozenHistoryLength);
  });
});
