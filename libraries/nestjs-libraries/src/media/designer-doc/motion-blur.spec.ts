import { describe, it, expect } from 'vitest';
import {
  motionBlurSampleTimes,
  motionBlurSource,
  shutterDurationMs,
  DEFAULT_MOTION_BLUR_SAMPLES,
  MAX_MOTION_BLUR_SAMPLES,
} from './motion-blur';

describe('shutterDurationMs', () => {
  it('opens for half a frame at the 180° default', () => {
    expect(shutterDurationMs(30, 180)).toBeCloseTo(1000 / 30 / 2);
  });

  it('opens for the whole frame at 360°', () => {
    expect(shutterDurationMs(25, 360)).toBeCloseTo(40);
  });

  it('is shut at 0°', () => {
    expect(shutterDurationMs(30, 0)).toBe(0);
  });

  it('clamps an out-of-range angle rather than exposing longer than a frame', () => {
    expect(shutterDurationMs(30, 720)).toBeCloseTo(1000 / 30);
    expect(shutterDurationMs(30, -90)).toBe(0);
  });
});

describe('motionBlurSampleTimes', () => {
  it('is one sample when the clip has no blur', () => {
    expect(motionBlurSampleTimes(500, 30, undefined)).toEqual([500]);
    expect(motionBlurSampleTimes(500, 30, { enabled: false })).toEqual([500]);
  });

  it('spreads samples across the shutter window', () => {
    const times = motionBlurSampleTimes(1000, 30, { enabled: true });
    expect(times).toHaveLength(DEFAULT_MOTION_BLUR_SAMPLES);
    const window = shutterDurationMs(30, 180);
    expect(Math.min(...times)).toBeGreaterThan(1000 - window / 2);
    expect(Math.max(...times)).toBeLessThan(1000 + window / 2);
  });

  it('centres the window on the frame, so the subject does not drift', () => {
    // A trailing-only window drags every blurred object back half a frame.
    const times = motionBlurSampleTimes(1000, 30, { enabled: true });
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    expect(mean).toBeCloseTo(1000, 6);
  });

  it('samples bin centres, so neighbouring frames do not double-count the seam', () => {
    const window = shutterDurationMs(30, 180);
    const times = motionBlurSampleTimes(0, 30, { enabled: true, samples: 2 });
    expect(times[0]).toBeCloseTo(-window / 4);
    expect(times[1]).toBeCloseTo(window / 4);
  });

  it('collapses to one sample at a shut shutter', () => {
    expect(motionBlurSampleTimes(100, 30, { enabled: true, shutterAngle: 0 })).toEqual([100]);
  });

  it('collapses to one sample when one is asked for', () => {
    expect(motionBlurSampleTimes(100, 30, { enabled: true, samples: 1 })).toEqual([100]);
  });

  it('caps the sample count — this multiplies render time', () => {
    expect(
      motionBlurSampleTimes(100, 30, { enabled: true, samples: 500 })
    ).toHaveLength(MAX_MOTION_BLUR_SAMPLES);
  });

  it('treats a zero or negative sample count as no blur, not a crash', () => {
    expect(motionBlurSampleTimes(100, 30, { enabled: true, samples: 0 })).toEqual([100]);
    expect(motionBlurSampleTimes(100, 30, { enabled: true, samples: -4 })).toEqual([100]);
  });

  it('returns times in order', () => {
    const times = motionBlurSampleTimes(1000, 24, { enabled: true, samples: 6 });
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });
});

describe('motionBlurSource', () => {
  it('runs, and agrees with the imported functions', () => {
    const fn = new Function(
      `${motionBlurSource()}
      return motionBlurSampleTimes;`
    ) as () => typeof motionBlurSampleTimes;
    const injected = fn();
    expect(injected(1000, 30, { enabled: true })).toEqual(
      motionBlurSampleTimes(1000, 30, { enabled: true })
    );
  });
});
