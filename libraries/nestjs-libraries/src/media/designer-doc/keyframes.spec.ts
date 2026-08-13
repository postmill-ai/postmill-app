import { describe, it, expect } from 'vitest';
import {
  applyEasePreset,
  cubicBezierEase,
  easeSegment,
  interpolateClipKeyframes,
  keyframesSource,
  DEFAULT_IN_HANDLE,
  DEFAULT_OUT_HANDLE,
} from './keyframes';

/**
 * Easing is evaluated in exactly one place, and the third renderer is handed
 * that place as source. These pin both halves: the maths, and the fact that the
 * stringified copy still runs.
 */

describe('cubicBezierEase', () => {
  it('is the identity for the neutral handles', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      expect(cubicBezierEase(t, DEFAULT_OUT_HANDLE, DEFAULT_IN_HANDLE)).toBeCloseTo(t, 4);
    }
  });

  it('pins both ends', () => {
    expect(cubicBezierEase(0, [0.42, 0], [0.58, 1])).toBe(0);
    expect(cubicBezierEase(1, [0.42, 0], [0.58, 1])).toBe(1);
  });

  it('clamps outside the segment', () => {
    expect(cubicBezierEase(-0.5, [0.42, 0], [0.58, 1])).toBe(0);
    expect(cubicBezierEase(1.5, [0.42, 0], [0.58, 1])).toBe(1);
  });

  it('matches CSS ease-in-out at the midpoint', () => {
    expect(cubicBezierEase(0.5, [0.42, 0], [0.58, 1])).toBeCloseTo(0.5, 3);
  });

  it('starts slow for an ease-in curve', () => {
    // cubic-bezier(0.42, 0, 1, 1) — CSS's ease-in.
    const v = cubicBezierEase(0.25, [0.42, 0], [1, 1]);
    expect(v).toBeLessThan(0.25);
    expect(v).toBeGreaterThan(0);
  });

  it('finishes slow for an ease-out curve', () => {
    const v = cubicBezierEase(0.75, [0, 0], [0.58, 1]);
    expect(v).toBeGreaterThan(0.75);
    expect(v).toBeLessThan(1);
  });

  it('stays monotone across a steep handle', () => {
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const v = cubicBezierEase(i / 100, [0.9, 0.05], [0.1, 0.95]);
      expect(v).toBeGreaterThanOrEqual(last - 1e-6);
      last = v;
    }
  });

  it('does not spin on handles that make x non-monotone', () => {
    // A user can drag a handle past 1; the bisection fallback must still return.
    const v = cubicBezierEase(0.5, [1.6, 0], [-0.6, 1]);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('easeSegment', () => {
  it('falls back to the preset when neither end has handles', () => {
    expect(easeSegment(0.5, undefined, 'easeIn')).toBe(applyEasePreset(0.5, 'easeIn'));
    expect(easeSegment(0.5, 'easeOut', undefined)).toBe(applyEasePreset(0.5, 'easeOut'));
  });

  it('prefers the arriving keyframe’s preset, as it always did', () => {
    expect(easeSegment(0.3, 'easeIn', 'easeOut')).toBe(applyEasePreset(0.3, 'easeOut'));
  });

  it('uses handles when either end has them', () => {
    const withHandles = easeSegment(0.25, { out: [0.42, 0] }, { in: [1, 1] });
    expect(withHandles).toBeLessThan(0.25);
  });

  it('fills in the neutral handle for the end that has none', () => {
    // One-sided handles must not silently become linear.
    expect(easeSegment(0.5, { out: [0.9, 0.1] }, undefined)).not.toBeCloseTo(0.5, 3);
  });

  it('is linear with no easing at all', () => {
    expect(easeSegment(0.37, undefined, undefined)).toBe(0.37);
  });
});

describe('interpolateClipKeyframes', () => {
  const clip = {
    x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1,
    keyframes: [
      { tMs: 0, props: { x: 0, opacity: 0 } },
      { tMs: 1000, props: { x: 200, opacity: 1 } },
    ],
  };

  it('returns the clip’s own transform when there are no keyframes', () => {
    expect(interpolateClipKeyframes({ x: 5, y: 6, width: 7, height: 8 }, 500)).toEqual({
      x: 5, y: 6, width: 7, height: 8, rotation: 0, opacity: 1,
    });
  });

  it('holds the first keyframe before it', () => {
    expect(interpolateClipKeyframes(clip, -100).x).toBe(0);
  });

  it('holds the last keyframe after it', () => {
    expect(interpolateClipKeyframes(clip, 5000).x).toBe(200);
  });

  it('interpolates linearly in between', () => {
    expect(interpolateClipKeyframes(clip, 500).x).toBeCloseTo(100);
    expect(interpolateClipKeyframes(clip, 500).opacity).toBeCloseTo(0.5);
  });

  it('falls back to the clip value for a property no keyframe sets', () => {
    expect(interpolateClipKeyframes(clip, 500).height).toBe(100);
  });

  it('sorts keyframes given out of order', () => {
    const shuffled = { ...clip, keyframes: [clip.keyframes[1], clip.keyframes[0]] };
    expect(interpolateClipKeyframes(shuffled, 500).x).toBeCloseTo(100);
  });

  it('applies a bezier handle to the segment', () => {
    const eased = {
      ...clip,
      keyframes: [
        { tMs: 0, props: { x: 0 }, ease: { out: [0.42, 0] as [number, number] } },
        { tMs: 1000, props: { x: 200 }, ease: { in: [1, 1] as [number, number] } },
      ],
    };
    // Ease-in: a quarter of the way through time, well under a quarter of the way
    // through the move.
    expect(interpolateClipKeyframes(eased, 250).x).toBeLessThan(50);
  });

  it('handles two keyframes at the same time without dividing by zero', () => {
    const degenerate = {
      ...clip,
      keyframes: [
        { tMs: 0, props: { x: 0 } },
        { tMs: 500, props: { x: 100 } },
        { tMs: 500, props: { x: 300 } },
        { tMs: 1000, props: { x: 400 } },
      ],
    };
    expect(Number.isFinite(interpolateClipKeyframes(degenerate, 500).x)).toBe(true);
  });
});

describe('keyframesSource', () => {
  it('runs, and agrees with the imported functions', () => {
    // The third renderer gets this text. If it ever stops evaluating, or drifts
    // from the module, an exported mp4 eases differently from the preview.
    const fn = new Function(
      `${keyframesSource()}
      return { interpolateClipKeyframes, cubicBezierEase };`
    ) as () => {
      interpolateClipKeyframes: typeof interpolateClipKeyframes;
      cubicBezierEase: typeof cubicBezierEase;
    };
    const injected = fn();

    const clip = {
      x: 0, width: 10, height: 10,
      keyframes: [
        { tMs: 0, props: { x: 0 }, ease: { out: [0.42, 0] as [number, number] } },
        { tMs: 1000, props: { x: 100 }, ease: { in: [0.58, 1] as [number, number] } },
      ],
    };

    for (const ms of [0, 125, 250, 500, 750, 999, 1000]) {
      expect(injected.interpolateClipKeyframes(clip, ms).x).toBeCloseTo(
        interpolateClipKeyframes(clip, ms).x,
        6
      );
    }
    expect(injected.cubicBezierEase(0.3, [0.9, 0.1], [0.1, 0.9])).toBeCloseTo(
      cubicBezierEase(0.3, [0.9, 0.1], [0.1, 0.9]),
      6
    );
  });
});
