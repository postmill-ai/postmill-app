import { describe, expect, it } from 'vitest';
import { createDesignerStore } from './designer.store';
import type { VideoClip, VideoOutput } from './designer.store';
import { mergeKeyframes, KEYFRAME_MERGE_TOLERANCE_MS } from './keyframe-props';

const videoStore = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  return store;
};

const vo = (store: ReturnType<typeof createDesignerStore>, outputIndex = 0) =>
  store.getState().doc.outputs[outputIndex] as VideoOutput;

const addTrack = (store: ReturnType<typeof createDesignerStore>, type: VideoOutput['tracks'][number]['type']) => {
  store.getState().addTrack(0, type);
  return vo(store).tracks[vo(store).tracks.length - 1].id;
};

const addClip = (
  store: ReturnType<typeof createDesignerStore>,
  trackId: string,
  values: Partial<VideoClip> & { id: string }
) => {
  store.getState().addClip(0, trackId, {
    startMs: 0,
    endMs: 4000,
    ...values,
  } as VideoClip);
};

const findClip = (store: ReturnType<typeof createDesignerStore>, trackId: string, clipId: string) =>
  vo(store).tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);

const animatedSource = (store: ReturnType<typeof createDesignerStore>, trackId: string) => {
  addClip(store, trackId, {
    id: 'source',
    text: 'source text',
    src: 'source-asset',
    fileId: 'source-file',
    x: 100,
    y: 200,
    width: 200,
    height: 100,
    keyframes: [
      { tMs: 0, props: { x: 100, y: 200, width: 200, opacity: 0, volume: 0.4 }, ease: 'easeInOut' },
      { tMs: 1000, props: { x: 160, y: 160, width: 100, opacity: 1 } },
    ],
    motionPath: {
      points: [{ x: 200, y: 250, tMs: 0 }, { x: 260, y: 310, tMs: 4000 }],
      followRotation: true,
    },
  });
};

describe('mergeKeyframes', () => {
  it('overwrites a prop the target already carries within the tolerance, keeps the rest', () => {
    const merged = mergeKeyframes(
      [{ tMs: 1000, props: { x: 5, opacity: 1 }, ease: 'linear' }],
      [{ tMs: 1000 + KEYFRAME_MERGE_TOLERANCE_MS, props: { x: 9, y: 3 }, ease: 'easeIn' }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].props).toEqual({ x: 9, opacity: 1, y: 3 });
    expect(merged[0].ease).toBe('easeIn');
  });

  it('adds keyframes with no target in range and keeps the target ease when none is copied', () => {
    const merged = mergeKeyframes(
      [{ tMs: 1000, props: { x: 5 }, ease: 'easeOut' }],
      [{ tMs: 1002, props: { y: 1 } }, { tMs: 500, props: { opacity: 0 } }]
    );
    expect(merged.map((kf) => kf.tMs)).toEqual([500, 1000, 1002]);
    expect(merged[1].ease).toBe('easeOut');
  });

  it('does not mutate either input', () => {
    const target = [{ tMs: 0, props: { x: 1 } }];
    const incoming = [{ tMs: 0, props: { y: 2 } }];
    const merged = mergeKeyframes(target, incoming);
    expect(target[0].props).toEqual({ x: 1 });
    expect(incoming[0].props).toEqual({ y: 2 });
    merged[0].props.x = 99;
    expect(target[0].props.x).toBe(1);
  });
});

describe('keyframe copy/paste between clips', () => {
  const addTwoClips = (store: ReturnType<typeof createDesignerStore>) => {
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'src',
      startMs: 0,
      endMs: 4000,
      keyframes: [
        { tMs: 0, props: { x: 0, opacity: 0 }, ease: 'easeIn' },
        { tMs: 1000, props: { x: 100 } },
      ],
    } as never);
    store.getState().addClip(0, trackId, {
      id: 'dst',
      startMs: 4000,
      endMs: 8000,
      keyframes: [{ tMs: 1000, props: { x: 55, rotation: 10 } }],
    } as never);
    return trackId;
  };

  it('merges onto the selected clip at the same clip-relative times, one history entry, undoable', () => {
    const store = videoStore();
    const trackId = addTwoClips(store);
    store.getState().copyClipKeyframes(0, trackId, 'src');
    expect(store.getState().keyframeClipboard).toHaveLength(2);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });
    const depth = store.getState().history.length;
    store.getState().pasteClipKeyframes();

    const dst = vo(store).tracks[0].clips.find((c) => c.id === 'dst')!;
    expect(dst.keyframes).toHaveLength(2);
    const at1000 = dst.keyframes!.find((kf) => kf.tMs === 1000)!;
    expect(at1000.props).toEqual({ x: 100, rotation: 10 });
    expect(dst.keyframes![0]).toEqual({ tMs: 0, props: { x: 0, opacity: 0 }, ease: 'easeIn' });
    expect(store.getState().history.length).toBe(depth + 1);
    store.getState().undo();
    expect(
      vo(store).tracks[0].clips.find((c) => c.id === 'dst')!.keyframes
    ).toEqual([{ tMs: 1000, props: { x: 55, rotation: 10 } }]);
  });

  it('deep-clones both ways: source edits do not rewrite the clipboard, paste edits do not reach it', () => {
    const store = videoStore();
    const trackId = addTwoClips(store);
    store.getState().copyClipKeyframes(0, trackId, 'src');

    store.getState().updateClip(0, trackId, 'src', {
      keyframes: [{ tMs: 0, props: { x: 999 } }],
    } as never);
    expect(store.getState().keyframeClipboard![1].props.x).toBe(100);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });
    store.getState().pasteClipKeyframes();

    store.getState().updateClip(0, trackId, 'dst', {
      keyframes: [{ tMs: 0, props: { x: -1 } }],
    } as never);
    expect(store.getState().keyframeClipboard![0].props.x).toBe(0);
    const src = vo(store).tracks[0].clips.find((c) => c.id === 'src')!;
    expect(src.keyframes).toEqual([{ tMs: 0, props: { x: 999 } }]);
  });

  it('paste with atMs shifts the batch so its earliest keyframe lands there', () => {
    const store = videoStore();
    const trackId = addTwoClips(store);
    store.getState().copyClipKeyframes(0, trackId, 'src');
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });

    store.getState().pasteClipKeyframes(500);

    const dst = vo(store).tracks[0].clips.find((c) => c.id === 'dst')!;
    expect(dst.keyframes!.map((kf) => kf.tMs)).toEqual([500, 1000, 1500]);
  });

  it('clamps pasted keyframes into the target clip duration', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    store.getState().addClip(0, trackId, {
      id: 'src',
      startMs: 0,
      endMs: 4000,
      keyframes: [{ tMs: 3500, props: { x: 1 } }],
    } as never);
    store.getState().addClip(0, trackId, { id: 'dst', startMs: 4000, endMs: 5000 } as never);
    store.getState().copyClipKeyframes(0, trackId, 'src');
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });
    store.getState().pasteClipKeyframes();

    const dst = vo(store).tracks[0].clips.find((c) => c.id === 'dst')!;
    expect(dst.keyframes).toEqual([{ tMs: 1000, props: { x: 1 } }]);
  });

  it('is a no-op without a clipboard or without a selected clip', () => {
    const store = videoStore();
    const trackId = addTwoClips(store);
    const depth = store.getState().history.length;

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });
    store.getState().pasteClipKeyframes();
    expect(store.getState().history.length).toBe(depth);

    store.getState().copyClipKeyframes(0, trackId, 'src');
    store.getState().setSelectedClip(null);
    store.getState().pasteClipKeyframes();
    expect(store.getState().history.length).toBe(depth);

    const store2 = videoStore();
    const trackId2 = vo(store2).tracks[0].id;
    store2.getState().addClip(0, trackId2, { id: 'plain', startMs: 0, endMs: 1000 } as never);
    store2.getState().copyClipKeyframes(0, trackId2, 'plain');
    expect(store2.getState().keyframeClipboard).toBeNull();
  });
});

describe('audio keyframe copy/paste', () => {
  it('copies a volume envelope onto another audio clip with deep cloning and one Undo', () => {
    const store = videoStore();
    const sourceTrack = addTrack(store, 'audio');
    const targetTrack = addTrack(store, 'audio');
    addClip(store, sourceTrack, {
      id: 'audio-source',
      keyframes: [
        { tMs: 0, props: { volume: 0 } },
        { tMs: 1000, props: { volume: 1 } },
      ],
    });
    addClip(store, targetTrack, { id: 'audio-target' });
    store.getState().copyClipKeyframes(0, sourceTrack, 'audio-source');
    store.getState().updateClip(0, sourceTrack, 'audio-source', {
      keyframes: [{ tMs: 0, props: { volume: 0.5 } }],
    });

    store.getState().setSelectedClip({ outputIndex: 0, trackId: targetTrack, clipId: 'audio-target' });
    const before = store.getState().doc;
    const depth = store.getState().history.length;
    store.getState().pasteClipKeyframes();

    expect(findClip(store, targetTrack, 'audio-target')?.keyframes).toEqual([
      { tMs: 0, props: { volume: 0 } },
      { tMs: 1000, props: { volume: 1 } },
    ]);
    expect(store.getState().history.length).toBe(depth + 1);
    expect(store.getState().historyLabels.at(-1)).toBe('Paste keyframes');
    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
  });
});

describe('animation copy/paste between clips', () => {
  it('pastes onto multiple targets atomically with target-relative timing, geometry, audio, and one Undo', () => {
    const store = videoStore();
    const sourceTrack = vo(store).tracks[0].id;
    const targetTrack = addTrack(store, 'image');
    animatedSource(store, sourceTrack);
    addClip(store, sourceTrack, {
      id: 'first',
      startMs: 4000,
      endMs: 8000,
      text: 'first target',
      src: 'first-asset',
      originId: 'first-origin',
      x: 300,
      y: 400,
      width: 400,
      height: 200,
      volume: 0.8,
      speedCurve: [{ atMs: 0, speed: 1 }, { atMs: 1000, speed: 2 }],
      keyframes: [{ tMs: 250, props: { volume: 0.7, rotation: 90 }, ease: 'easeIn' }],
    });
    addClip(store, targetTrack, {
      id: 'second',
      startMs: 1000,
      endMs: 3000,
      src: 'second-asset',
      x: 500,
      y: 600,
      width: 100,
      height: 50,
    });
    expect(store.getState().copyAnimation(0, sourceTrack, 'source', 'org-a')).toEqual({
      status: 'copied',
      skipped: ['audio'],
    });

    const refs = [
      { trackId: sourceTrack, clipId: 'first' },
      { trackId: targetTrack, clipId: 'second' },
    ];
    store.getState().setSelectedClips(refs, refs[1]);
    const primary = store.getState().selectedClip;
    const before = store.getState().doc;
    const depth = store.getState().history.length;
    const result = store.getState().pasteAnimation(0, refs, 'org-a');

    expect(result.status).toBe('pasted');
    expect(result.targetCount).toBe(2);
    expect(result.skipped[0]).toEqual({ reasons: ['audio'] });
    expect(store.getState().history.length).toBe(depth + 1);
    expect(store.getState().historyLabels.at(-1)).toBe('Paste animation');
    expect(store.getState().selectedClip).toBe(primary);

    const first = findClip(store, sourceTrack, 'first')!;
    expect(first.keyframes).toEqual([
      { tMs: 0, props: { x: 300, y: 400, width: 400, opacity: 0 }, ease: 'easeInOut' },
      { tMs: 250, props: { volume: 0.7 }, ease: 'easeIn' },
      { tMs: 1000, props: { x: 360, y: 360, width: 200, opacity: 1 } },
    ]);
    expect(first).toMatchObject({
      text: 'first target',
      src: 'first-asset',
      originId: 'first-origin',
      startMs: 4000,
      endMs: 8000,
      volume: 0.8,
      speedCurve: [{ atMs: 0, speed: 1 }, { atMs: 1000, speed: 2 }],
    });
    const second = findClip(store, targetTrack, 'second')!;
    expect(second.keyframes?.map((keyframe) => keyframe.tMs)).toEqual([0, 500]);
    expect(second.keyframes?.[1].props.x).toBe(560);
    expect(second.motionPath).toEqual({
      points: [{ x: 550, y: 625, tMs: 0 }, { x: 610, y: 685, tMs: 2000 }],
      followRotation: true,
    });
    expect(second.src).toBe('second-asset');

    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
  });

  it('survives selection changes and deep-clones source, clipboard, and pasted objects', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    animatedSource(store, trackId);
    addClip(store, trackId, { id: 'target', startMs: 4000, endMs: 8000, x: 300 });
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');
    const clipboard = store.getState().animationClipboard;

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'target' });
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'source' });
    expect(store.getState().animationClipboard).toBe(clipboard);

    store.getState().updateClip(0, trackId, 'source', {
      keyframes: [{ tMs: 0, props: { x: 999 } }],
    });
    expect(clipboard?.snapshot.keyframes[1].props.x).toBe(160);

    store.getState().pasteAnimation(0, [{ trackId, clipId: 'target' }], 'org-a');
    const target = findClip(store, trackId, 'target')!;
    target.keyframes![0].props.x = -1;
    target.motionPath!.points[0].x = -1;
    expect(clipboard?.snapshot.keyframes[0].props.x).toBe(100);
    expect(clipboard?.snapshot.motionPath?.points[0].x).toBe(200);
  });

  it('expands persistent groups and commits every member in the same history step', () => {
    const store = videoStore();
    const sourceTrack = vo(store).tracks[0].id;
    const groupTrack = addTrack(store, 'shape');
    animatedSource(store, sourceTrack);
    addClip(store, sourceTrack, { id: 'first', groupId: 'group', x: 100 });
    addClip(store, groupTrack, { id: 'second', groupId: 'group', x: 500 });
    store.getState().copyAnimation(0, sourceTrack, 'source', 'org-a');
    const depth = store.getState().history.length;

    const result = store.getState().pasteAnimation(0, [{ trackId: sourceTrack, clipId: 'first' }], 'org-a');
    expect(result.targetCount).toBe(2);
    expect(store.getState().history.length).toBe(depth + 1);
    expect(findClip(store, sourceTrack, 'first')?.keyframes?.[0].props.x).toBe(100);
    expect(findClip(store, groupTrack, 'second')?.keyframes?.[0].props.x).toBe(500);
  });

  it('skips locked and unknown targets, and makes no edit when every target is blocked', () => {
    const store = videoStore();
    const sourceTrack = vo(store).tracks[0].id;
    const lockedTrack = addTrack(store, 'image');
    animatedSource(store, sourceTrack);
    addClip(store, lockedTrack, { id: 'locked' });
    store.getState().copyAnimation(0, sourceTrack, 'source', 'org-a');
    store.getState().setTrackLocked(0, lockedTrack, true);
    const before = store.getState().doc;
    const depth = store.getState().history.length;
    const dirty = store.getState().isDirty;

    const result = store.getState().pasteAnimation(0, [
      { trackId: lockedTrack, clipId: 'locked' },
      { trackId: 'missing-track', clipId: 'missing' },
    ], 'org-a');
    expect(result.status).toBe('no-targets');
    expect(result.skipped).toEqual(expect.arrayContaining([
      { clipId: 'locked', reasons: ['locked'] },
      { clipId: 'missing', reasons: ['unknown'] },
    ]));
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history.length).toBe(depth);
    expect(store.getState().isDirty).toBe(dirty);
  });

  it('never pastes across organizations and rejects frozen-output mutations', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    animatedSource(store, trackId);
    addClip(store, trackId, { id: 'target', startMs: 4000, endMs: 8000 });
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');
    const ref = [{ trackId, clipId: 'target' }];
    const before = store.getState().doc;
    const depth = store.getState().history.length;

    expect(store.getState().pasteAnimation(0, ref, 'org-b').status).toBe('org-mismatch');
    expect(store.getState().pasteAnimation(0, ref).status).toBe('org-mismatch');
    expect(store.getState().doc).toBe(before);

    store.getState().setOutputFrozen(0, true);
    const frozen = store.getState().doc;
    expect(store.getState().copyAnimation(0, trackId, 'source', 'org-a').status).toBe('copied');
    expect(store.getState().pasteAnimation(0, ref, 'org-a').status).toBe('frozen');
    expect(store.getState().doc).toBe(frozen);
    expect(store.getState().history.length).toBe(depth + 1);
  });

  it('keeps animation format-local when target clips share an originId', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    animatedSource(store, trackId);
    addClip(store, trackId, {
      id: 'target',
      startMs: 4000,
      endMs: 8000,
      originId: 'linked-target',
      keyframes: [{ tMs: 0, props: { opacity: 1 } }],
    });
    store.getState().addOutput({ formatId: 'story', name: 'Story', width: 1080, height: 1920 });
    const otherOutput = vo(store, 1);
    const linked = otherOutput.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.originId === 'linked-target');
    expect(linked).toBeDefined();
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');

    const result = store.getState().pasteAnimation(0, [{ trackId, clipId: 'target' }], 'org-a');
    expect(result.status).toBe('pasted');
    expect(vo(store, 1)).toBe(otherOutput);
    expect(findClip(store, trackId, 'target')?.originId).toBe('linked-target');
  });

  it('requires an organization on copy and clears any stale snapshot', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    animatedSource(store, trackId);
    addClip(store, trackId, { id: 'target', startMs: 4000, endMs: 8000 });
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');
    expect(store.getState().animationClipboard).not.toBeNull();

    expect(store.getState().copyAnimation(0, trackId, 'source')).toEqual({
      status: 'org-required',
      skipped: [],
    });
    expect(store.getState().animationClipboard).toBeNull();
    expect(store.getState().pasteAnimation(0, [{ trackId, clipId: 'target' }], 'org-a').status).toBe('empty');
  });

  it('stamps a v14 document to v15 when pasting a motion path', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    animatedSource(store, trackId);
    addClip(store, trackId, { id: 'target', startMs: 4000, endMs: 8000 });
    store.setState((state) => ({ doc: { ...state.doc, version: 14 } }));
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');

    expect(store.getState().pasteAnimation(0, [{ trackId, clipId: 'target' }], 'org-a').status).toBe('pasted');
    expect(store.getState().doc.version).toBe(15);
  });

  it('clears a stale snapshot after an unsupported copy and reports incompatible or unchanged pastes', () => {
    const store = videoStore();
    const trackId = vo(store).tracks[0].id;
    animatedSource(store, trackId);
    addClip(store, trackId, { id: 'plain', startMs: 4000, endMs: 8000 });
    store.getState().copyAnimation(0, trackId, 'source', 'org-a');
    expect(store.getState().animationClipboard).not.toBeNull();

    expect(store.getState().copyAnimation(0, trackId, 'plain', 'org-a').status).toBe('empty');
    expect(store.getState().animationClipboard).toBeNull();
    const depth = store.getState().history.length;
    expect(store.getState().pasteAnimation(0, [{ trackId, clipId: 'plain' }], 'org-a').status).toBe('empty');
    expect(store.getState().history.length).toBe(depth);

    store.getState().copyAnimation(0, trackId, 'source', 'org-a');
    expect(store.getState().pasteAnimation(0, [{ trackId, clipId: 'source' }], 'org-a')).toMatchObject({
      status: 'no-targets',
      targetCount: 0,
      skipped: expect.arrayContaining([{ clipId: 'source', reasons: ['unchanged'] }]),
    });
    expect(store.getState().history.length).toBe(depth);
  });
});
