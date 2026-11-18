import { describe, expect, it } from 'vitest';
import { createDesignerStore } from './designer.store';
import type {
  VideoClip,
  VideoOutput,
  VideoTrack,
} from './designer.store';

const clip = (
  id: string,
  startMs = 0,
  endMs = 1000,
  over: Partial<VideoClip> = {}
): VideoClip => ({ id, startMs, endMs, ...over });

const track = (
  id: string,
  type: VideoTrack['type'],
  clips: VideoClip[],
  over: Partial<VideoTrack> = {}
): VideoTrack => ({ id, type, clips, ...over });

const videoOutput = (tracks: VideoTrack[], over: Partial<VideoOutput> = {}): VideoOutput => ({
  id: 'output',
  formatId: 'square',
  name: 'Square',
  width: 500,
  height: 500,
  fps: 30,
  durationMs: 10000,
  tracks,
  ...over,
});

const storeWith = (outputs: VideoOutput[]) => {
  const store = createDesignerStore();
  store.getState().loadDesign({
    version: 14,
    mode: 'video',
    outputs,
  }, 'design', 'Arrange clips');
  return store;
};

const outputAt = (store: ReturnType<typeof createDesignerStore>, index = 0) =>
  store.getState().doc.outputs[index] as VideoOutput;

describe('arrangeVideoClips store action', () => {
  it('commits a shared-track extraction once and restores clips and tracks with Undo/Redo', () => {
    const selected = clip('selected', 125, 975, {
      originId: 'origin',
      trimInMs: 10,
      transitionIn: { type: 'fade', durationMs: 100 },
      keyframes: [{ tMs: 20, props: { x: 30 } }],
    });
    const store = storeWith([videoOutput([
      track('source', 'video', [selected, clip('resident', 2000, 3000)]),
      track('shape', 'shape', [clip('shape')]),
    ])]);
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;
    store.getState().setSelectedClip({ outputIndex: 0, trackId: 'source', clipId: 'selected' });

    expect(store.getState().arrangeVideoClips(0, [
      { trackId: 'source', clipId: 'selected' },
    ], 'forward')).toBe('ok');

    const arranged = store.getState().doc;
    const tracks = outputAt(store).tracks;
    expect(tracks.map((item) => [item.type, item.clips.map((item) => item.id)])).toEqual([
      ['video', ['resident']],
      ['shape', ['shape']],
      ['video', ['selected']],
    ]);
    expect(tracks[2].clips[0]).toEqual(selected);
    expect(store.getState().history).toHaveLength(historyBefore + 1);
    expect(store.getState().historyLabels.at(-1)).toBe('Bring clip forward');
    const destination = store.getState().selectedClips[0].trackId;
    expect(store.getState().selectedClip).toEqual({
      outputIndex: 0,
      trackId: destination,
      clipId: 'selected',
    });

    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    store.getState().redo();
    expect(store.getState().doc).toBe(arranged);
  });

  it('moves the full multi-selection as one block in one history entry', () => {
    const store = storeWith([videoOutput([
      track('a', 'video', [clip('a-clip')]),
      track('b', 'shape', [clip('b-clip')]),
      track('c', 'text', [clip('c-clip')]),
      track('d', 'image', [clip('d-clip')]),
    ])]);
    const refs = [
      { trackId: 'a', clipId: 'a-clip' },
      { trackId: 'c', clipId: 'c-clip' },
    ];
    store.getState().setSelectedClips(refs, refs[1]);
    const historyBefore = store.getState().history.length;

    expect(store.getState().arrangeVideoClips(0, refs, 'forward')).toBe('ok');
    expect(outputAt(store).tracks.map((item) => item.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(store.getState().selectedClips).toEqual(refs);
    expect(store.getState().selectedClip).toEqual({ outputIndex: 0, ...refs[1] });
    expect(store.getState().history).toHaveLength(historyBefore + 1);

    store.getState().undo();
    expect(outputAt(store).tracks.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('expands persistent groups and retains their ids and linked origins', () => {
    const store = storeWith([videoOutput([
      track('video', 'video', [clip('video-clip', 0, 1000, { groupId: 'group', originId: 'video-origin' })]),
      track('shape', 'shape', [clip('shape-clip', 0, 1000, { groupId: 'group', originId: 'shape-origin' })]),
      track('text', 'text', [clip('text-clip')]),
    ])]);
    store.getState().setSelectedClip({ outputIndex: 0, trackId: 'video', clipId: 'video-clip' });
    const historyBefore = store.getState().history.length;

    expect(store.getState().arrangeVideoClips(0, [
      { trackId: 'video', clipId: 'video-clip' },
    ], 'front')).toBe('ok');
    expect(outputAt(store).tracks.map((item) => item.id)).toEqual(['text', 'video', 'shape']);
    expect(store.getState().selectedClips).toHaveLength(2);
    expect(outputAt(store).tracks.flatMap((item) => item.clips)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'video-clip', groupId: 'group', originId: 'video-origin' }),
      expect.objectContaining({ id: 'shape-clip', groupId: 'group', originId: 'shape-origin' }),
    ]));
    expect(store.getState().history).toHaveLength(historyBefore + 1);
  });

  it('keeps arrangement format-local and preserves linked content in other outputs', () => {
    const linkedOutput = videoOutput([
      track('linked-video', 'video', [clip('linked-clip', 0, 1000, { originId: 'shared' })]),
    ]);
    const store = storeWith([
      videoOutput([
        track('source', 'video', [clip('selected', 0, 1000, { originId: 'shared' })]),
        track('shape', 'shape', [clip('shape')]),
      ]),
      linkedOutput,
    ]);
    const siblingBefore = store.getState().doc.outputs[1];

    expect(store.getState().arrangeVideoClips(0, [
      { trackId: 'source', clipId: 'selected' },
    ], 'forward')).toBe('ok');
    expect(store.getState().doc.outputs[1]).toBe(siblingBefore);
    expect(outputAt(store, 1)).toEqual(linkedOutput);
    expect(outputAt(store, 0).tracks[1].clips[0].originId).toBe('shared');
  });

  it('rejects locked, frozen, audio, unknown, and extreme requests without history', () => {
    const cases = [
      {
        status: 'locked',
        output: videoOutput([track('source', 'video', [clip('selected')], { locked: true })]),
      },
      {
        status: 'frozen',
        output: videoOutput([track('source', 'video', [clip('selected')])], { frozen: true }),
      },
      {
        status: 'audio',
        output: videoOutput([track('source', 'audio', [clip('selected')])]),
      },
      {
        status: 'already-front',
        output: videoOutput([track('source', 'video', [clip('selected')])]),
      },
    ] as const;

    for (const testCase of cases) {
      const store = storeWith([testCase.output]);
      const before = store.getState().doc;
      const historyBefore = store.getState().history.length;
      expect(store.getState().arrangeVideoClips(0, [
        { trackId: 'source', clipId: 'selected' },
      ], 'front')).toBe(testCase.status);
      expect(store.getState().doc).toBe(before);
      expect(store.getState().history).toHaveLength(historyBefore);
    }

    const store = storeWith([videoOutput([track('source', 'video', [clip('selected')])])]);
    const before = store.getState().doc;
    const historyBefore = store.getState().history.length;
    expect(store.getState().arrangeVideoClips(0, [
      { trackId: 'source', clipId: 'unknown' },
    ], 'front')).toBe('unknown-clip');
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history).toHaveLength(historyBefore);
  });
});
