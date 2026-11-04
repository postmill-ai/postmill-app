import { describe, expect, it } from 'vitest';
import { clipTimingTrackOptions, clipTimingUpdate } from './clip-timing';
import type { VideoClip } from './designer.store';

const clip: VideoClip = {
  id: 'clip-1',
  startMs: 1000,
  endMs: 4000,
  trimInMs: 500,
  speed: 1,
  src: '/video.mp4',
};

describe('clipTimingUpdate', () => {
  it('moves Start without changing duration or the source window', () => {
    expect(clipTimingUpdate(clip, 'start', 2500, clipTimingTrackOptions('video', 10000, 12000))).toEqual({
      startMs: 2500,
      endMs: 5500,
    });
  });

  it('trims End while preserving Start', () => {
    expect(clipTimingUpdate(clip, 'end', 5000, clipTimingTrackOptions('video', 10000, 12000))).toEqual({
      startMs: 1000,
      endMs: 5000,
    });
  });

  it('changes Duration through the same source-aware end-trim rules', () => {
    expect(clipTimingUpdate(clip, 'duration', 2000, clipTimingTrackOptions('video', 10000, 12000))).toEqual({
      startMs: 1000,
      endMs: 3000,
    });
  });

  it('enforces the 100ms minimum and output bounds', () => {
    expect(clipTimingUpdate(clip, 'duration', 20, clipTimingTrackOptions('image', undefined, 12000))).toEqual({
      startMs: 1000,
      endMs: 1100,
    });
    expect(clipTimingUpdate(clip, 'start', 11000, clipTimingTrackOptions('image', undefined, 12000))).toEqual({
      startMs: 9000,
      endMs: 12000,
    });
  });

  it('does not extend a video clip beyond its probed source', () => {
    expect(clipTimingUpdate(clip, 'duration', 20000, clipTimingTrackOptions('video', 7000, 30000))).toEqual({
      startMs: 1000,
      endMs: 7500,
    });
  });
});
