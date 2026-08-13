import { describe, it, expect } from 'vitest';
import {
  detectBeats,
  energyEnvelope,
  estimateBpm,
  nearestBeat,
  snapToBeat,
} from './beat-detect';

/**
 * Beat detection, against a synthetic click track — the only way to know the
 * right answer. Silence and steady tones matter as much as the clicks: false
 * beats are worse than no beats, because a cut snaps to them.
 */

const SAMPLE_RATE = 8000;

/** A click track: short bursts of noise at a fixed interval, silence between. */
const clickTrack = (bpm: number, seconds: number): Float32Array => {
  const samples = new Float32Array(SAMPLE_RATE * seconds);
  const interval = Math.round((60 / bpm) * SAMPLE_RATE);
  const burst = Math.round(SAMPLE_RATE * 0.01);
  for (let start = 0; start < samples.length; start += interval) {
    for (let i = 0; i < burst && start + i < samples.length; i++) {
      // Decaying burst — a plateau would make every window in it a "rise".
      samples[start + i] = (1 - i / burst) * (i % 2 ? 1 : -1);
    }
  }
  return samples;
};

describe('energyEnvelope', () => {
  it('summarises the signal into windows', () => {
    const env = energyEnvelope(new Float32Array(SAMPLE_RATE), SAMPLE_RATE, 20);
    expect(env).toHaveLength(50);
  });

  it('is zero for silence', () => {
    const env = energyEnvelope(new Float32Array(1000), SAMPLE_RATE, 20);
    expect(env.every((v) => v === 0)).toBe(true);
  });

  it('rises where the signal does', () => {
    const samples = new Float32Array(SAMPLE_RATE);
    samples.fill(1, 0, 160);
    const env = energyEnvelope(samples, SAMPLE_RATE, 20);
    expect(env[0]).toBeGreaterThan(env[10]);
  });
});

describe('detectBeats', () => {
  it('finds the clicks in a 120 BPM track', () => {
    const beats = detectBeats(clickTrack(120, 4), SAMPLE_RATE);
    // 4 seconds at 120 BPM = 8 beats; the first may fall inside the warm-up.
    expect(beats.length).toBeGreaterThanOrEqual(6);
    expect(beats.length).toBeLessThanOrEqual(9);
  });

  it('places them roughly half a second apart at 120 BPM', () => {
    const beats = detectBeats(clickTrack(120, 4), SAMPLE_RATE);
    for (let i = 1; i < beats.length; i++) {
      expect(Math.abs(beats[i] - beats[i - 1] - 500)).toBeLessThan(60);
    }
  });

  it('finds nothing in silence', () => {
    expect(detectBeats(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE)).toEqual([]);
  });

  it('finds nothing in a steady tone — there is no onset to snap to', () => {
    const steady = new Float32Array(SAMPLE_RATE * 2);
    for (let i = 0; i < steady.length; i++) steady[i] = Math.sin(i / 10);
    expect(detectBeats(steady, SAMPLE_RATE).length).toBeLessThanOrEqual(1);
  });

  it('never returns two beats closer than the minimum gap', () => {
    const beats = detectBeats(clickTrack(300, 4), SAMPLE_RATE, { minGapMs: 300 });
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(300);
    }
  });

  it('returns nothing rather than throwing on an empty signal', () => {
    expect(detectBeats(new Float32Array(0), SAMPLE_RATE)).toEqual([]);
    expect(detectBeats(clickTrack(120, 1), 0)).toEqual([]);
  });

  it('returns times in order', () => {
    const beats = detectBeats(clickTrack(90, 6), SAMPLE_RATE);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]).toBeGreaterThan(beats[i - 1]);
    }
  });
});

describe('nearestBeat', () => {
  const beats = [0, 500, 1000, 1500];

  it('finds the closest one within tolerance', () => {
    expect(nearestBeat(beats, 520)).toBe(500);
    expect(nearestBeat(beats, 960)).toBe(1000);
  });

  it('returns null when nothing is close', () => {
    // Otherwise a clip edge leaps across a bar from wherever it was dropped.
    expect(nearestBeat(beats, 750)).toBeNull();
  });

  it('respects an explicit tolerance', () => {
    expect(nearestBeat(beats, 700, 300)).toBe(500);
  });

  it('resolves a dead-centre time to the EARLIER beat, deterministically', () => {
    expect(nearestBeat(beats, 750, 300)).toBe(500);
  });

  it('has no answer with no beats', () => {
    expect(nearestBeat([], 100)).toBeNull();
  });
});

describe('snapToBeat', () => {
  it('snaps when close and leaves the time alone when not', () => {
    expect(snapToBeat([0, 500], 480)).toBe(500);
    expect(snapToBeat([0, 500], 300)).toBe(300);
  });
});

describe('estimateBpm', () => {
  it('reads the tempo off evenly spaced beats', () => {
    expect(estimateBpm([0, 500, 1000, 1500])).toBe(120);
  });

  it('survives a missed beat, because it uses the median', () => {
    // A mean would be dragged halfway to nonsense by the doubled gap.
    expect(estimateBpm([0, 500, 1500, 2000, 2500])).toBe(120);
  });

  it('has no answer from too few beats', () => {
    expect(estimateBpm([0, 500])).toBeNull();
    expect(estimateBpm([])).toBeNull();
  });
});
