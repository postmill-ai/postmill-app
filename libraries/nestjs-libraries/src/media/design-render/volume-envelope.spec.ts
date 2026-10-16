import { describe, it, expect } from 'vitest';
import { volumeAtClipTime } from '../designer-doc/keyframes';
import {
  VOLUME_ENVELOPE_STEP_MS,
  envelopeIsConstant,
  sampleVolumeEnvelope,
  volumeEnvelopeExpr,
  volumeEnvelopeValueAt,
} from './volume-envelope';

/**
 * Volume-keyframe parity: the preview sets the media element's volume from the
 * shared interpolation EVERY TICK; the export replays a piecewise-linear ffmpeg
 * expression sampled from that same function. These tests pin the gap between
 * the two to within one 100ms quantisation step.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** What the preview puts on the element: keyframed volume × trackGain, clamped. */
const previewVolume = (clip: any, trackGain: number, ms: number): number =>
  clamp01(volumeAtClipTime(clip, ms) * trackGain);

describe('volume envelope parity', () => {
  const durationMs = 4000;
  const trackGain = 0.8;

  // A bezier-eased pair — the case where naive linear-between-keyframes export
  // would diverge from the preview by half the clip.
  const bezierClip: any = {
    volume: 1,
    keyframes: [
      { tMs: 0, props: { volume: 0 }, ease: { out: [0.42, 0] } },
      { tMs: durationMs, props: { volume: 1 }, ease: { in: [0.58, 1] } },
    ],
  };

  it('stays within one 100ms quantisation step of the preview across the clip', () => {
    const points = sampleVolumeEnvelope(bezierClip, trackGain, durationMs);
    // The loosest honest bound: within a segment, the linear replay sits between
    // its endpoint samples and the true eased curve is continuous, so the gap is
    // bounded by the largest per-step sample delta (plus fp dust).
    const maxStep = Math.max(
      ...points.slice(1).map((p, i) => Math.abs(p.v - points[i].v))
    );
    expect(maxStep).toBeGreaterThan(0); // the fixture actually moves

    for (let ms = 0; ms <= durationMs; ms += 25) {
      const expr = volumeEnvelopeValueAt(points, ms / 1000);
      const preview = previewVolume(bezierClip, trackGain, ms);
      expect(Math.abs(expr - preview)).toBeLessThanOrEqual(maxStep + 1e-9);
    }
  });

  it('pins the eased mid-clip values the expression actually produces', () => {
    const points = sampleVolumeEnvelope(bezierClip, trackGain, durationMs);
    // Ease-in-out: the midpoint is 0.5 × trackGain by symmetry, quantised to
    // land on a 100ms boundary (4000ms is a multiple of 100ms).
    expect(volumeEnvelopeValueAt(points, 2)).toBeCloseTo(0.5 * trackGain, 3);
    // Eased, not linear: a quarter of the time in, well under a quarter of the
    // way up — the bezier had to survive the sampling.
    expect(volumeEnvelopeValueAt(points, 1)).toBeLessThan(0.25 * trackGain);
  });

  it('the expression string evaluates to exactly the envelope', () => {
    const points = sampleVolumeEnvelope(bezierClip, trackGain, durationMs);
    const expr = volumeEnvelopeExpr(points)!;
    expect(expr).toBeTruthy();
    // ffmpeg's expression grammar is JS-compatible for the ops we emit
    // (numbers, +, -, *, parentheses, min) — eval it with `t` bound.
    const evalExpr = new Function(
      't',
      `return ${expr.replace(/min\(/g, 'Math.min(')};`
    ) as (t: number) => number;
    for (let tS = 0; tS <= durationMs / 1000; tS += 0.05) {
      // 6-decimal rounding in the emitted numbers — the divergence ceiling is
      // ~1e-8, far below anything audible.
      expect(evalExpr(tS)).toBeCloseTo(volumeEnvelopeValueAt(points, tS), 5);
    }
    // The only commas are min()'s argument separator — and the encoder quotes
    // the whole expression so the filtergraph parser never sees them.
    expect(expr.replace(/min\([^)]*\)/g, '')).not.toContain(',');
  });

  it('bakes track gain into the values, clamped like the preview', () => {
    const hot: any = {
      keyframes: [
        { tMs: 0, props: { volume: 1 } },
        { tMs: 1000, props: { volume: 1 } },
      ],
    };
    const points = sampleVolumeEnvelope(hot, 2, 1000);
    expect(points[0].v).toBe(1); // 1 × 2 clamped to the element's [0,1]
  });

  it('returns no expression for a constant envelope', () => {
    const flat: any = {
      keyframes: [
        { tMs: 0, props: { volume: 0.5 } },
        { tMs: 1000, props: { volume: 0.5 } },
      ],
    };
    const points = sampleVolumeEnvelope(flat, 1, 1000);
    expect(envelopeIsConstant(points)).toBe(true);
    expect(volumeEnvelopeExpr(points)).toBeNull();
  });

  it('handles a duration that is not a multiple of the step', () => {
    const clip: any = {
      keyframes: [
        { tMs: 0, props: { volume: 0 } },
        { tMs: 1250, props: { volume: 1 } },
      ],
    };
    const points = sampleVolumeEnvelope(clip, 1, 1250);
    const last = points[points.length - 1];
    expect(last.tS).toBeCloseTo(1.25);
    expect(last.v).toBeCloseTo(1);
    // The shortened final segment replays the right end value.
    expect(volumeEnvelopeValueAt(points, 1.25)).toBeCloseTo(1);
    expect(volumeEnvelopeValueAt(points, 2)).toBeCloseTo(1); // holds past the end
  });

  it('quantises bezier and preset easings identically — both sides sample the same function', () => {
    // The easing code path is shared, so this is the construction's guarantee
    // stated as a test: the envelope's samples ARE the preview's values at the
    // 100ms grid points, bit for bit.
    const presetClip: any = {
      keyframes: [
        { tMs: 0, props: { volume: 0.1 }, ease: 'easeInOut' },
        { tMs: 2000, props: { volume: 0.9 } },
      ],
    };
    const points = sampleVolumeEnvelope(presetClip, 1, 2000);
    for (const p of points) {
      expect(p.v).toBe(previewVolume(presetClip, 1, p.tS * 1000));
    }
    expect(points.length).toBe(2000 / VOLUME_ENVELOPE_STEP_MS + 1);
  });
});
