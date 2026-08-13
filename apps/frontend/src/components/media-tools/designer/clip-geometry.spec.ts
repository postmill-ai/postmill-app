import { describe, it, expect } from 'vitest';
import { clipGeometryUpdate, hasKeyframeAtPlayhead, type ClipBox } from './clip-geometry';
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
