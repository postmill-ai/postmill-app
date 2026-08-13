import { describe, it, expect } from 'vitest';
import { timelineBeats } from './beat-sync';

/**
 * Beats are stored RELATIVE to their own clip, so a clip dragged along the
 * timeline carries its grid with it. This is the conversion back to absolute
 * time, and getting it wrong puts every cut a clip-offset away from the music.
 */

const audio = (startMs: number, beats?: number[]) => ({
  type: 'audio',
  clips: [{ startMs, beats }],
});

describe('timelineBeats', () => {
  it('offsets each clip’s beats by where the clip sits', () => {
    expect(timelineBeats([audio(1000, [0, 500, 1000])])).toEqual([1000, 1500, 2000]);
  });

  it('gathers beats from every audio clip', () => {
    expect(
      timelineBeats([
        { type: 'audio', clips: [{ startMs: 0, beats: [0, 500] }, { startMs: 2000, beats: [0] }] },
      ])
    ).toEqual([0, 500, 2000]);
  });

  it('ignores non-audio tracks', () => {
    expect(
      timelineBeats([
        { type: 'video', clips: [{ startMs: 0, beats: [0, 100] }] },
        audio(0, [250]),
      ])
    ).toEqual([250]);
  });

  it('is empty until something has been analysed', () => {
    expect(timelineBeats([audio(0)])).toEqual([]);
    expect(timelineBeats([])).toEqual([]);
  });

  it('deduplicates beats two clips share', () => {
    expect(
      timelineBeats([
        { type: 'audio', clips: [{ startMs: 0, beats: [500] }, { startMs: 500, beats: [0] }] },
      ])
    ).toEqual([500]);
  });

  it('returns them in order regardless of clip order', () => {
    expect(
      timelineBeats([
        { type: 'audio', clips: [{ startMs: 5000, beats: [0] }, { startMs: 0, beats: [100] }] },
      ])
    ).toEqual([100, 5000]);
  });
});
