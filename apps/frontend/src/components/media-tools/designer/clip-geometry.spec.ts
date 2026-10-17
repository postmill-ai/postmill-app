import { describe, it, expect } from 'vitest';
import { clipEdgeUpdate, clipGeometryUpdate, hasKeyframeAtPlayhead, canDropClipOnTrack, type ClipBox } from './clip-geometry';
import type { VideoClip } from './designer.store';

const clip = (over: Partial<VideoClip> = {}): VideoClip =>
  ({
    id: 'c1',
    startMs: 1000,
    endMs: 5000,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    ...over,
  }) as VideoClip;

const box = (over: Partial<ClipBox> = {}): ClipBox => ({
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  ...over,
});

describe('clipGeometryUpdate', () => {
  it('ignores a gesture that moved nothing', () => {
    expect(clipGeometryUpdate(clip(), box(), box(), 2000)).toBeNull();
  });

  it('writes base props for a clip with no keyframes', () => {
    const update = clipGeometryUpdate(clip(), box(), box({ x: 40, y: 25 }), 2000);
    expect(update).toEqual({ x: 40, y: 25, width: 100, height: 50, rotation: 0 });
  });

  it('applies the gesture as a DELTA, so an animated clip keeps its animation', () => {
    // Rendered at x=200 by a keyframe, base x=10. Dragging 30px right must move
    // the whole animation by 30 — writing the rendered value would slam the base
    // to 230 and make the clip jump.
    const animated = clip({
      keyframes: [
        { tMs: 0, props: { x: 200 } },
        { tMs: 2000, props: { x: 400 } },
      ],
    });
    const update = clipGeometryUpdate(
      animated,
      box({ x: 200 }),
      box({ x: 230 }),
      2500 // between keyframes: 1500ms relative, no keyframe there
    );
    expect(update?.x).toBe(40);
    expect(update?.keyframes).toBeUndefined();
  });

  it('edits the keyframe under the playhead instead of the base props', () => {
    const animated = clip({
      keyframes: [
        { tMs: 0, props: { x: 200 } },
        { tMs: 1000, props: { x: 400 } },
      ],
    });
    // Playhead 2000 = 1000ms into the clip = exactly the second keyframe.
    const update = clipGeometryUpdate(
      animated,
      box({ x: 400 }),
      box({ x: 450 }),
      2000
    );
    expect(update?.x).toBeUndefined();
    expect(update?.keyframes?.[1].props.x).toBe(450);
    // The other keyframe is untouched.
    expect(update?.keyframes?.[0].props.x).toBe(200);
  });

  it('bakes a resize into width/height and never below 1px', () => {
    const update = clipGeometryUpdate(
      clip(),
      box(),
      box({ width: 250, height: 0 }),
      2000
    );
    expect(update?.width).toBe(250);
    expect(update?.height).toBe(1);
  });

  it('carries rotation through', () => {
    const update = clipGeometryUpdate(clip(), box(), box({ rotation: 45 }), 2000);
    expect(update?.rotation).toBe(45);
  });

  it('seeds absent keyframe props from the rendered box', () => {
    // The keyframe only animates x; resizing at that instant must still record a
    // height rather than dropping the gesture.
    const animated = clip({ keyframes: [{ tMs: 500, props: { x: 300 } }] });
    const update = clipGeometryUpdate(
      animated,
      box({ x: 300 }),
      box({ x: 300, height: 80 }),
      1500
    );
    expect(update?.keyframes?.[0].props.height).toBe(80);
    expect(update?.keyframes?.[0].props.x).toBe(300);
  });
});

describe('hasKeyframeAtPlayhead', () => {
  it('is true only within a millisecond of a keyframe', () => {
    const animated = clip({ keyframes: [{ tMs: 1000, props: {} }] });
    expect(hasKeyframeAtPlayhead(animated, 2000)).toBe(true);
    expect(hasKeyframeAtPlayhead(animated, 2001)).toBe(true);
    expect(hasKeyframeAtPlayhead(animated, 2050)).toBe(false);
  });

  it('is false for a clip with no keyframes', () => {
    expect(hasKeyframeAtPlayhead(clip(), 2000)).toBe(false);
  });
});

describe('clipEdgeUpdate', () => {
  const av = { hasSourceWindow: true, maxEndMs: 60000 };

  it('start-edge trim advances trimInMs by the same delta (head is CUT, not slid)', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 0 });
    const update = clipEdgeUpdate(c, 'start', 2500, av);
    expect(update.startMs).toBe(2500);
    expect(update.endMs).toBe(5000);
    expect(update.trimInMs).toBe(1500);
  });

  it('start-edge extension left re-winds trimInMs but never below 0', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 800 });
    // 600ms left: within the available 800ms of trimmed head.
    expect(clipEdgeUpdate(c, 'start', 400, av)).toEqual({
      startMs: 400,
      endMs: 5000,
      trimInMs: 200,
    });
    // 2000ms left: only 800ms of source head exists — the edge stops there.
    const update = clipEdgeUpdate(c, 'start', 0, av);
    expect(update.startMs).toBe(200);
    expect(update.trimInMs).toBe(0);
  });

  it('scales the trim delta by the clip speed', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 0, speed: 2 });
    // 1s of timeline at 2x consumes 2s of source.
    expect(clipEdgeUpdate(c, 'start', 2000, av).trimInMs).toBe(2000);
  });

  it('leaves trimInMs alone on a freeze (speed:0) clip', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 3200, speed: 0 });
    const update = clipEdgeUpdate(c, 'start', 2000, av);
    expect(update.startMs).toBe(2000);
    // Omitted = unchanged: the frozen frame must not move to another time.
    expect(update.trimInMs).toBeUndefined();
  });

  it('end-edge extension is clamped to the probed source duration', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 2000 });
    // Source is 8s: 2s already trimmed in, 4s on the timeline → 2s of headroom.
    const update = clipEdgeUpdate(c, 'end', 30000, { ...av, sourceDurationMs: 8000 });
    expect(update.endMs).toBe(7000);
  });

  it('end-edge headroom shrinks with speed', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 0, speed: 2 });
    // 8s source at 2x → at most 4s of timeline.
    const update = clipEdgeUpdate(c, 'end', 30000, { ...av, sourceDurationMs: 8000 });
    expect(update.endMs).toBe(5000);
  });

  it('end-edge extends freely (up to the output cap) when the source duration is unknown', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 0 });
    const update = clipEdgeUpdate(c, 'end', 30000, av);
    expect(update.endMs).toBe(30000);
  });

  it('image/text clips have no source window: edges move, trimInMs untouched', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 500 });
    expect(
      clipEdgeUpdate(c, 'start', 2000, { hasSourceWindow: false, maxEndMs: 60000 })
    ).toEqual({ startMs: 2000, endMs: 5000 });
    expect(
      clipEdgeUpdate(c, 'end', 40000, { hasSourceWindow: false, maxEndMs: 60000 })
    ).toEqual({ startMs: 1000, endMs: 40000 });
  });

  it('keeps the minimum clip duration on both edges', () => {
    const c = clip({ startMs: 1000, endMs: 5000 });
    expect(clipEdgeUpdate(c, 'start', 4950, av).startMs).toBe(4900);
    expect(clipEdgeUpdate(c, 'end', 1050, av).endMs).toBe(1100);
  });

  it('reverse clips consume source from the other side: start edge keeps trimInMs…', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 1000, reverse: true });
    const update = clipEdgeUpdate(c, 'start', 2500, av);
    // Omitted = unchanged: the reversed end frame stays anchored to trimInMs.
    expect(update.trimInMs).toBeUndefined();
    // …but extending left past the probed source end is still clamped.
    const clamped = clipEdgeUpdate(c, 'start', 0, { ...av, sourceDurationMs: 6000 });
    // Window can be at most 6000 - 1000 = 5000ms → startMs >= 0 here.
    expect(clamped.startMs).toBe(0);
    const tight = clipEdgeUpdate(c, 'start', 0, { ...av, sourceDurationMs: 4000 });
    expect(tight.startMs).toBe(2000); // window capped at 3000ms
  });

  it('reverse end-edge extension pulls trimInMs down and bottoms out at 0', () => {
    const c = clip({ startMs: 1000, endMs: 5000, trimInMs: 1000, reverse: true });
    expect(clipEdgeUpdate(c, 'end', 5500, av)).toEqual({
      startMs: 1000,
      endMs: 5500,
      trimInMs: 500,
    });
    // Only 1000ms of earlier source exists: 3s of extension collapses to 1s.
    const update = clipEdgeUpdate(c, 'end', 8000, av);
    expect(update.endMs).toBe(6000);
    expect(update.trimInMs).toBe(0);
  });
});

describe('canDropClipOnTrack', () => {
  it('allows same-type drops and rejects cross-type drops', () => {
    expect(canDropClipOnTrack('video', 'video')).toBe(true);
    expect(canDropClipOnTrack('audio', 'audio')).toBe(true);
    expect(canDropClipOnTrack('video', 'caption')).toBe(false);
    expect(canDropClipOnTrack('caption', 'video')).toBe(false);
    expect(canDropClipOnTrack('image', 'text')).toBe(false);
    expect(canDropClipOnTrack('text', 'caption')).toBe(false);
  });
});
