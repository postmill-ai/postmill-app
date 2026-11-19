import { describe, expect, it } from 'vitest';
import { createDesignerStore } from './designer.store';
import type { VideoClip, VideoOutput } from './designer.store';

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
