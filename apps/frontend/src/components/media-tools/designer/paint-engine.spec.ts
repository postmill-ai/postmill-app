import { describe, it, expect } from 'vitest';
import { cloneStrokeOffset, stageSnapshotArgs } from './paint-engine';

/**
 * The two pieces of pure math the paint-tool fixes rely on:
 *  - the Clone Stamp's stroke-relative sampling offset;
 *  - the zoom/pan compensation that keeps a stage snapshot in document pixels.
 */

describe('cloneStrokeOffset', () => {
  it('is the Alt-clicked source relative to the stroke’s first paint point', () => {
    // Alt-click at (200, 100), stroke starting at (500, 400): painting at the
    // start samples (200, 100), so the offset is anchor − start.
    expect(cloneStrokeOffset({ x: 200, y: 100 }, { x: 500, y: 400 })).toEqual({
      x: -300,
      y: -300,
    });
  });

  it('is undefined until the source is Alt-clicked — stamp() must bail', () => {
    expect(cloneStrokeOffset(null, { x: 10, y: 10 })).toBeUndefined();
    expect(cloneStrokeOffset({ x: 10, y: 10 }, null)).toBeUndefined();
    expect(cloneStrokeOffset(null, null)).toBeUndefined();
  });

  it('moves the sample with the stroke, not with the anchor alone', () => {
    // The old bug used the absolute anchor as the offset, sampling at
    // dest + anchor. With the fix, a point 30px right of the stroke start
    // samples 30px right of the anchor.
    const offset = cloneStrokeOffset({ x: 100, y: 100 }, { x: 300, y: 300 });
    const dest = { x: 330, y: 300 };
    expect({ x: dest.x + offset!.x, y: dest.y + offset!.y }).toEqual({ x: 130, y: 100 });
  });
});

describe('stageSnapshotArgs', () => {
  it('at zoom 1 with no pan, the identity mapping', () => {
    expect(stageSnapshotArgs({ x: 0, y: 0, scale: 1 }, { width: 1080, height: 1080 })).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
      pixelRatio: 1,
    });
  });

  it('folds zoom and pan into the toCanvas rect, back out via pixelRatio', () => {
    // fit-to-screen on a big artboard: zoom 0.5, panned to centre.
    const args = stageSnapshotArgs({ x: 120, y: 60, scale: 0.5 }, { width: 1080, height: 720 });
    expect(args).toEqual({ x: 120, y: 60, width: 540, height: 360, pixelRatio: 2 });
    // The produced canvas is back at document resolution: width × pixelRatio.
    expect(args.width * args.pixelRatio).toBe(1080);
    expect(args.height * args.pixelRatio).toBe(720);
  });

  it('zoomed in past 100% still round-trips to document pixels', () => {
    const args = stageSnapshotArgs({ x: -400, y: -200, scale: 2.5 }, { width: 1000, height: 800 });
    expect(args.width * args.pixelRatio).toBeCloseTo(1000);
    expect(args.height * args.pixelRatio).toBeCloseTo(800);
    expect(args.pixelRatio).toBeCloseTo(0.4);
  });

  it('treats a zero scale as 1 rather than dividing by zero', () => {
    const args = stageSnapshotArgs({ x: 0, y: 0, scale: 0 }, { width: 100, height: 100 });
    expect(args.pixelRatio).toBe(1);
    expect(args.width).toBe(100);
  });
});
