import { describe, it, expect } from 'vitest';
import { createDesignerStore } from './designer.store';
import type { VideoOutput } from './designer.store';
import { mergeKeyframes, KEYFRAME_MERGE_TOLERANCE_MS } from './keyframe-props';

/**
 * Keyframe copy/paste between clips: merge-by-prop semantics, deep-clone
 * isolation in both directions, and one history entry per paste.
 */

const videoStore = () => {
  const store = createDesignerStore();
  store.getState().setMode('video');
  return store;
};
const vo = (store: ReturnType<typeof createDesignerStore>) =>
  store.getState().doc.outputs[0] as VideoOutput;

describe('mergeKeyframes', () => {
  it('overwrites a prop the target already carries within the tolerance, keeps the rest', () => {
    const merged = mergeKeyframes(
      [{ tMs: 1000, props: { x: 5, opacity: 1 }, ease: 'linear' }],
      [{ tMs: 1000 + KEYFRAME_MERGE_TOLERANCE_MS, props: { x: 9, y: 3 }, ease: 'easeIn' }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].props).toEqual({ x: 9, opacity: 1, y: 3 });
    // An incoming ease replaces the target's.
    expect(merged[0].ease).toBe('easeIn');
  });

  it('adds keyframes with no target in range and keeps the target ease when none is copied', () => {
    const merged = mergeKeyframes(
      [{ tMs: 1000, props: { x: 5 }, ease: 'easeOut' }],
      [{ tMs: 1002, props: { y: 1 } }, { tMs: 500, props: { opacity: 0 } }]
    );
    // 1002 is outside the 1ms window — a new keyframe, and the result is sorted.
    expect(merged.map((kf) => kf.tMs)).toEqual([500, 1000, 1002]);
    expect(merged[1].ease).toBe('easeOut');
  });

  it('does not mutate either input', () => {
    const target = [{ tMs: 0, props: { x: 1 } }];
    const incoming = [{ tMs: 0, props: { y: 2 } }];
    const merged = mergeKeyframes(target, incoming);
    expect(target[0].props).toEqual({ x: 1 });
    expect(incoming[0].props).toEqual({ y: 2 });
    // Editing the merge result reaches neither input.
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
    // Same tMs → x overwritten, rotation kept, ease replaced.
    const at1000 = dst.keyframes!.find((kf) => kf.tMs === 1000)!;
    expect(at1000.props).toEqual({ x: 100, rotation: 10 });
    // New keyframe added with its ease, sorted first.
    expect(dst.keyframes![0]).toEqual({ tMs: 0, props: { x: 0, opacity: 0 }, ease: 'easeIn' });
    // One history entry; undo restores the target's original keyframes.
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

    // Edit the source AFTER copying — the clipboard keeps the copied values.
    store.getState().updateClip(0, trackId, 'src', {
      keyframes: [{ tMs: 0, props: { x: 999 } }],
    } as never);
    expect(store.getState().keyframeClipboard![1].props.x).toBe(100);

    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });
    store.getState().pasteClipKeyframes();

    // Edit the pasted result — neither the clipboard nor the source clip moves.
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
    // Copied tMs were 0 and 1000 → 500 and 1500; 1500 merges with nothing
    // (dst's own keyframe sits at 1000), 500 is new.
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

    // No clipboard.
    store.getState().setSelectedClip({ outputIndex: 0, trackId, clipId: 'dst' });
    store.getState().pasteClipKeyframes();
    expect(store.getState().history.length).toBe(depth);

    // Clipboard set but nothing selected.
    store.getState().copyClipKeyframes(0, trackId, 'src');
    store.getState().setSelectedClip(null);
    store.getState().pasteClipKeyframes();
    expect(store.getState().history.length).toBe(depth);

    // Copying a keyframe-less clip leaves the clipboard empty.
    const store2 = videoStore();
    const trackId2 = vo(store2).tracks[0].id;
    store2.getState().addClip(0, trackId2, { id: 'plain', startMs: 0, endMs: 1000 } as never);
    store2.getState().copyClipKeyframes(0, trackId2, 'plain');
    expect(store2.getState().keyframeClipboard).toBeNull();
  });
});
