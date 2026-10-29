import { describe, expect, it } from 'vitest';
import {
  moveClipPreservingDuration,
  timelineCollisionToleranceMs,
  timelineIsNewTrackZone,
  timelineSnapThresholdMs,
  timelineTrackAtClientY,
  timelineTrackIndexAtClientY,
} from './timeline-geometry';

const geometry = { rulerHeight: 22, trackHeight: 36, trackGap: 4 };

describe('timeline row geometry', () => {
  it('measures rows from the scroll viewport, excluding only its ruler', () => {
    expect(timelineTrackIndexAtClientY(140, 100, 0, geometry)).toBe(0);
    expect(timelineTrackIndexAtClientY(180, 100, 0, geometry)).toBe(1);
    expect(timelineTrackIndexAtClientY(140, 100, 80, geometry)).toBe(2);
  });

  it('does not include toolbar height in row hit-testing', () => {
    const tracks = ['first', 'second'];
    expect(timelineTrackAtClientY(tracks, 180, 100, 0, geometry)).toBe('second');
    expect(timelineTrackAtClientY(tracks, 99, 100, 0, geometry)).toBeUndefined();
  });

  it('limits intentional track creation to the virtual row below the last row', () => {
    expect(timelineIsNewTrackZone(2, 40, 220, 100, 0, geometry)).toBe(true);
    expect(timelineIsNewTrackZone(2, 40, 260, 100, 0, geometry)).toBe(false);
    expect(timelineIsNewTrackZone(40, 40, 220, 100, 0, geometry)).toBe(false);
  });
});

describe('timeline thresholds', () => {
  it('keeps edge snapping small and zoom-aware at min/default/max zoom', () => {
    expect(timelineSnapThresholdMs(0.01)).toBe(100);
    expect(timelineSnapThresholdMs(0.25)).toBe(24);
    expect(timelineSnapThresholdMs(4)).toBe(1.5);
  });

  it('uses a separate, tighter tolerance for collision relocation', () => {
    for (const zoom of [0.01, 0.25, 4]) {
      expect(timelineCollisionToleranceMs(zoom)).toBeLessThan(
        timelineSnapThresholdMs(zoom)
      );
      expect(timelineCollisionToleranceMs(zoom)).toBeLessThanOrEqual(40);
    }
  });
});

describe('moveClipPreservingDuration', () => {
  it('moves both clip edges', () => {
    expect(moveClipPreservingDuration({ startMs: 1000, endMs: 4500 }, 100, 10000)).toEqual({
      startMs: 1100,
      endMs: 4600,
    });
  });

  it('clamps at both composition boundaries without trimming', () => {
    expect(moveClipPreservingDuration({ startMs: 1000, endMs: 4500 }, -5000, 10000)).toEqual({
      startMs: 0,
      endMs: 3500,
    });
    expect(moveClipPreservingDuration({ startMs: 1000, endMs: 4500 }, 9000, 10000)).toEqual({
      startMs: 6500,
      endMs: 10000,
    });
  });
});
