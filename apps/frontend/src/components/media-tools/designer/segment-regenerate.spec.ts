import { describe, it, expect } from 'vitest';
import {
  defaultSegmentWindow,
  findMiddleClipId,
  isValidSegmentWindow,
  isWholeClipWindow,
  planSegmentSplits,
  segmentSourceTrim,
} from './segment-regenerate';

describe('defaultSegmentWindow', () => {
  it('centers a 2s window on the playhead', () => {
    expect(defaultSegmentWindow(10000, 5000)).toEqual({ startMs: 4000, endMs: 6000 });
  });

  it('clamps to the clip start', () => {
    expect(defaultSegmentWindow(10000, 300)).toEqual({ startMs: 0, endMs: 2000 });
  });

  it('clamps to the clip end', () => {
    expect(defaultSegmentWindow(10000, 9800)).toEqual({ startMs: 8000, endMs: 10000 });
  });

  it('shrinks to the clip when the clip is shorter than the window', () => {
    expect(defaultSegmentWindow(1500, 700)).toEqual({ startMs: 0, endMs: 1500 });
  });
});

describe('isValidSegmentWindow', () => {
  it('accepts an interior window', () => {
    expect(isValidSegmentWindow({ startMs: 1000, endMs: 3000 }, 10000)).toBe(true);
  });

  it('rejects windows outside the clip, tiny windows and over-cap spans', () => {
    expect(isValidSegmentWindow({ startMs: -100, endMs: 3000 }, 10000)).toBe(false);
    expect(isValidSegmentWindow({ startMs: 1000, endMs: 12000 }, 10000)).toBe(false);
    expect(isValidSegmentWindow({ startMs: 1000, endMs: 1050 }, 10000)).toBe(false);
    expect(isValidSegmentWindow({ startMs: 0, endMs: 31000 }, 60000)).toBe(false);
  });
});

describe('isWholeClipWindow', () => {
  it('detects full-clip windows', () => {
    expect(isWholeClipWindow({ startMs: 0, endMs: 10000 }, 10000)).toBe(true);
    expect(isWholeClipWindow({ startMs: 500, endMs: 10000 }, 10000)).toBe(false);
  });
});

describe('segmentSourceTrim', () => {
  it('offsets by trimInMs', () => {
    expect(segmentSourceTrim({ trimInMs: 3000 }, { startMs: 1000, endMs: 2000 })).toEqual({
      trimStartMs: 4000,
      trimEndMs: 5000,
    });
  });

  it('scales by playback speed', () => {
    expect(segmentSourceTrim({ trimInMs: 1000, speed: 2 }, { startMs: 1000, endMs: 2000 })).toEqual({
      trimStartMs: 3000,
      trimEndMs: 5000,
    });
  });

  it('defaults missing trimIn/speed to 0/1', () => {
    expect(segmentSourceTrim({}, { startMs: 500, endMs: 1500 })).toEqual({
      trimStartMs: 500,
      trimEndMs: 1500,
    });
  });
});

describe('planSegmentSplits', () => {
  const clip = { startMs: 10000, endMs: 20000 };

  it('plans two splits for an interior window', () => {
    expect(planSegmentSplits(clip, { startMs: 2000, endMs: 5000 })).toEqual({
      startSplitMs: 12000,
      endSplitMs: 15000,
      middleStartMs: 12000,
      middleEndMs: 15000,
    });
  });

  it('absorbs edges within the 100ms guard instead of splitting', () => {
    expect(planSegmentSplits(clip, { startMs: 50, endMs: 9950 })).toEqual({
      startSplitMs: null,
      endSplitMs: null,
      middleStartMs: 10000,
      middleEndMs: 20000,
    });
  });

  it('splits only the end when the window starts at the clip start', () => {
    expect(planSegmentSplits(clip, { startMs: 0, endMs: 4000 })).toEqual({
      startSplitMs: null,
      endSplitMs: 14000,
      middleStartMs: 10000,
      middleEndMs: 14000,
    });
  });
});

describe('findMiddleClipId', () => {
  it('finds the clip matching the planned bounds', () => {
    const clips = [
      { id: 'before', startMs: 10000, endMs: 12000 },
      { id: 'middle', startMs: 12000, endMs: 15000 },
      { id: 'after', startMs: 15000, endMs: 20000 },
    ];
    expect(
      findMiddleClipId(clips, {
        startSplitMs: 12000,
        endSplitMs: 15000,
        middleStartMs: 12000,
        middleEndMs: 15000,
      }),
    ).toBe('middle');
  });

  it('returns null when no clip matches', () => {
    expect(
      findMiddleClipId([], {
        startSplitMs: 1,
        endSplitMs: 2,
        middleStartMs: 1,
        middleEndMs: 2,
      }),
    ).toBeNull();
  });
});
