import { describe, it, expect } from 'vitest';
import {
  reflowVideoClip,
  reflowVideoOutputInPlace,
  seedVideoOutput,
} from './video-reflow';
import type { VideoClip, VideoOutput } from './designer-doc.schema';

/**
 * Video variant reflow (add-format / resize for video docs). The important
 * scenarios are aspect flips: 16:9 ↔ 9:16.
 */

const LANDSCAPE = { width: 1920, height: 1080, formatId: 'custom-wide' };
const PORTRAIT = { width: 1080, height: 1920, formatId: 'custom-tall' };

const clip = (over: Partial<VideoClip>): VideoClip => ({
  id: 'c1',
  startMs: 1000,
  endMs: 4000,
  ...over,
});

const makeOutput = (tracks: VideoOutput['tracks'], over: Partial<VideoOutput> = {}): VideoOutput => ({
  id: 'out-v1',
  formatId: 'custom-wide',
  name: 'Wide',
  width: LANDSCAPE.width,
  height: LANDSCAPE.height,
  fps: 30,
  durationMs: 10000,
  tracks,
  ...over,
});

describe('reflowVideoClip', () => {
  it('re-anchors a bottom-centered text clip on a 16:9 → 9:16 flip', () => {
    // Centered horizontally (960 = mid), sitting in the bottom third.
    const c = clip({
      x: 560, y: 900, width: 800, height: 120, fontSize: 48, text: 'Hi',
    });
    const out = reflowVideoClip(c, 'text', LANDSCAPE, PORTRAIT);
    // Same type basis (sqrt(1080·1920) both ways) → no size change…
    expect(out.width).toBe(800);
    expect(out.height).toBe(120);
    expect(out.fontSize).toBe(48);
    // …but bottom-center anchoring re-homes it on the tall canvas, clamped
    // into the title-safe area (5% fallback inset for non-platform formats):
    // bottom edge = 1920·0.95 = 1824, minus the 120px box.
    expect(out.x).toBe((1080 - 800) / 2);
    expect(out.y).toBe(Math.round(1920 * 0.95) - 120);
    // Timing is invariant.
    expect(out.startMs).toBe(1000);
    expect(out.endMs).toBe(4000);
  });

  it('scales cover video clips per-axis and sets a focal estimate', () => {
    const c = clip({
      x: 0, y: 0, width: 1920, height: 1080,
      src: 'https://example.com/v.mp4',
      fitMode: 'cover', naturalWidth: 1920, naturalHeight: 1080,
    });
    const out = reflowVideoClip(c, 'video', LANDSCAPE, PORTRAIT);
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(out.focalPoint).toEqual({ x: 0.5, y: 0.5 });
    expect(out.fitMode).toBe('cover');
  });

  it('fill clips stretch per-axis with no anchor snap', () => {
    const c = clip({ x: 100, y: 200, width: 400, height: 300, fitMode: 'fill' });
    const out = reflowVideoClip(c, 'video', LANDSCAPE, PORTRAIT);
    expect(out.x).toBe(Math.round(100 * (1080 / 1920)));
    expect(out.y).toBe(Math.round(200 * (1920 / 1080)));
    expect(out.width).toBe(Math.round(400 * (1080 / 1920)));
    expect(out.height).toBe(Math.round(300 * (1920 / 1080)));
  });

  it('leaves fullscreen (box-less) clips alone apart from the focal estimate', () => {
    const plain = clip({ src: 'https://example.com/v.mp4' });
    const plainOut = reflowVideoClip(plain, 'video', LANDSCAPE, PORTRAIT);
    expect(plainOut.x).toBeUndefined();
    expect(plainOut.width).toBeUndefined();
    expect(plainOut.focalPoint).toBeUndefined();
    const cover = clip({
      src: 'https://example.com/v.mp4',
      fitMode: 'cover', naturalWidth: 1920, naturalHeight: 1080,
    });
    expect(
      reflowVideoClip(cover, 'video', LANDSCAPE, PORTRAIT).focalPoint
    ).toBeDefined();
  });

  it('scales numeric keyframe geometry props by the clip box factors, never tMs', () => {
    const c = clip({
      x: 100, y: 100, width: 400, height: 300,
      shape: 'rect',
      keyframes: [
        { tMs: 0, props: { x: 100, width: 400, opacity: 1 } },
        { tMs: 1500, props: { x: 500, y: 300 } },
      ],
    });
    const out = reflowVideoClip(c, 'shape', LANDSCAPE, PORTRAIT);
    // Shape: uniform min-axis scale 1080/1920 = 0.5625.
    const f = 1080 / 1920;
    expect(out.width).toBe(Math.round(400 * f));
    expect(out.keyframes).toHaveLength(2);
    expect(out.keyframes![0].tMs).toBe(0);
    expect(out.keyframes![1].tMs).toBe(1500);
    expect(out.keyframes![0].props.x).toBe(Math.round(100 * f));
    expect(out.keyframes![0].props.width).toBe(Math.round(400 * f));
    expect(out.keyframes![1].props.x).toBe(Math.round(500 * f));
    expect(out.keyframes![1].props.y).toBe(Math.round(300 * f));
    // Non-geometry props pass through untouched.
    expect(out.keyframes![0].props.opacity).toBe(1);
  });

  it('never touches audio clips', () => {
    const c = clip({ x: 1, y: 2, width: 3, height: 4, volume: 0.7 });
    expect(reflowVideoClip(c, 'audio', LANDSCAPE, PORTRAIT)).toMatchObject({
      x: 1, y: 2, width: 3, height: 4, volume: 0.7,
    });
  });
});

describe('copy stacks across tracks', () => {
  it('keeps a headline + caption stack together on an aspect flip', () => {
    // Headline straddles the top-third boundary, caption just below it in the
    // same column — without the shared stack frame the thirds-bucketing would
    // anchor them to different bands and tear the pair apart.
    const headline = clip({
      id: 'h', x: 560, y: 300, width: 800, height: 100, fontSize: 64, text: 'Title',
    });
    const caption = clip({
      id: 'cap', x: 560, y: 420, width: 800, height: 60, fontSize: 32, text: 'sub',
    });
    const output = makeOutput([
      { id: 't1', type: 'text', clips: [headline] },
      { id: 't2', type: 'caption', clips: [caption] },
    ]);
    const resized = reflowVideoOutputInPlace(output, PORTRAIT.width, PORTRAIT.height, 'custom-tall');
    const h2 = resized.tracks[0].clips[0];
    const c2 = resized.tracks[1].clips[0];
    // The 20px stack gap survives exactly (offsets ride the shared frame).
    expect(c2.y! - (h2.y! + h2.height!)).toBe(20);
    // And the pair is centered as ONE unit (frame anchor), not split.
    const frameCenter = h2.y! + (c2.y! + c2.height! - h2.y!) / 2;
    expect(Math.abs(frameCenter - 1920 / 2)).toBeLessThanOrEqual(1);
  });
});

describe('seedVideoOutput', () => {
  it('clones tracks/clips with fresh ids, shared originIds, unchanged timing', () => {
    const output = makeOutput([
      {
        id: 't1',
        type: 'video',
        clips: [
          clip({ id: 'a', startMs: 0, endMs: 5000, trimInMs: 250, src: 'https://example.com/a.mp4' }),
          clip({ id: 'b', startMs: 5000, endMs: 9000, originId: 'origin-b', x: 100, y: 100, width: 400, height: 300, fitMode: 'fill' }),
        ],
      },
      { id: 't2', type: 'audio', clips: [clip({ id: 'm', startMs: 0, endMs: 9000 })] },
    ], { markers: [{ id: 'mk1', tMs: 2000, name: 'Beat' }] });

    let n = 0;
    const { output: seeded, sourceTracks } = seedVideoOutput(
      output,
      { width: PORTRAIT.width, height: PORTRAIT.height, formatId: 'custom-tall', name: 'Tall' },
      () => `gen-${++n}`
    );

    // Fresh ids everywhere; originId shared (and backfilled on the source).
    expect(seeded.id).not.toBe(output.id);
    expect(seeded.tracks[0].id).not.toBe('t1');
    expect(seeded.tracks[0].clips[0].id).not.toBe('a');
    expect(seeded.tracks[0].clips[0].originId).toBeTruthy();
    expect(sourceTracks[0].clips[0].originId).toBe(seeded.tracks[0].clips[0].originId);
    expect(seeded.tracks[0].clips[1].originId).toBe('origin-b');

    // Timing + playback semantics copy unchanged.
    expect(seeded.fps).toBe(30);
    expect(seeded.durationMs).toBe(10000);
    expect(seeded.tracks[0].clips[0]).toMatchObject({ startMs: 0, endMs: 5000, trimInMs: 250 });
    expect(seeded.tracks[1].clips[0]).toMatchObject({ startMs: 0, endMs: 9000 });

    // Markers ride along with fresh ids.
    expect(seeded.markers).toHaveLength(1);
    expect(seeded.markers![0].id).not.toBe('mk1');
    expect(seeded.markers![0].tMs).toBe(2000);

    // Geometry reflowed onto the tall canvas (fill clip stretches per-axis).
    expect(seeded.tracks[0].clips[1].width).toBe(Math.round(400 * (1080 / 1920)));
  });
});

describe('reflowVideoOutputInPlace', () => {
  it('preserves ids, applies format/name overrides, keeps fps/duration', () => {
    const output = makeOutput([
      { id: 't1', type: 'text', clips: [clip({ id: 'a', x: 560, y: 900, width: 800, height: 120, fontSize: 48, text: 'Hi' })] },
    ]);
    const resized = reflowVideoOutputInPlace(output, 1080, 1920, 'custom-tall', 'Tall');
    expect(resized.id).toBe('out-v1');
    expect(resized.tracks[0].id).toBe('t1');
    expect(resized.tracks[0].clips[0].id).toBe('a');
    expect(resized).toMatchObject({
      width: 1080, height: 1920, formatId: 'custom-tall', name: 'Tall', fps: 30, durationMs: 10000,
    });
    // Title-safe clamped bottom edge, same as the direct reflowVideoClip case.
    expect(resized.tracks[0].clips[0].y).toBe(Math.round(1920 * 0.95) - 120);
  });
});
