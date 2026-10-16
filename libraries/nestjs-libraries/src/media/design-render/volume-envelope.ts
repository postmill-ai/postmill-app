import {
  hasVolumeKeyframes,
  interpolateClipKeyframes,
  type KeyframedClip,
} from '../designer-doc/keyframes';

/**
 * Keyframed clip volume for the ffmpeg mixer.
 *
 * The preview evaluates the SHARED `interpolateClipKeyframes` per tick and sets
 * the media element's volume; a running `volume='<expr>':eval=frame` filter
 * cannot call back into that function, so the eased curve is quantised here —
 * sampled at 100ms steps and replayed as a piecewise-linear expression. Both
 * sides evaluate the same easing code, so the only divergence is the linear
 * error inside one 100ms step, which the parity spec pins.
 */

/** Envelope sampling quantum — the size of one linear segment. */
export const VOLUME_ENVELOPE_STEP_MS = 100;

export interface VolumeEnvelopePoint {
  /** Seconds from the clip's local start (its keyframe timeline). */
  tS: number;
  /** Volume with track gain baked in, clamped to [0,1] like the preview. */
  v: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** A number for an ffmpeg expression: 6 decimals, no trailing zeros. */
const fmt = (n: number): string => {
  const s = (Object.is(n, -0) ? 0 : n).toFixed(6);
  return (s.includes('.') ? s.replace(/\.?0+$/, '') : s) || '0';
};

/**
 * Sample the clip's effective volume — the shared interpolation, so bezier
 * easings quantise identically to the preview — at 100ms steps across the
 * clip's local timeline, with track gain baked into the values. The final
 * clamp to [0,1] matches the preview's media-element clamp.
 */
export function sampleVolumeEnvelope(
  clip: KeyframedClip,
  trackGain: number,
  durationMs: number
): VolumeEnvelopePoint[] {
  const points: VolumeEnvelopePoint[] = [];
  const steps = Math.max(1, Math.ceil(durationMs / VOLUME_ENVELOPE_STEP_MS));
  for (let i = 0; i <= steps; i++) {
    const ms = Math.min(durationMs, i * VOLUME_ENVELOPE_STEP_MS);
    const v = hasVolumeKeyframes(clip)
      ? interpolateClipKeyframes(clip, ms).volume
      : clip.volume == null
        ? 1
        : clip.volume;
    points.push({ tS: ms / 1000, v: clamp01(clamp01(v) * trackGain) });
  }
  return points;
}

/** A flat envelope needs no expression — the constant filter is identical. */
export function envelopeIsConstant(points: VolumeEnvelopePoint[]): boolean {
  return points.every((p) => Math.abs(p.v - points[0].v) < 1e-6);
}

/**
 * The envelope as a piecewise-linear ffmpeg `volume` expression:
 *
 *   v0 + Σ slope_i·(min(t,T_{i+1}) − min(t,T_i))
 *
 * A flat sum, not nested if() — a 60s clip produces ~600 segments, and a
 * nested-if chain that deep risks the expression parser's recursion. In the
 * mixer's filter chain the expression sits AFTER atrim/asetpts (and any
 * atempo), so `t` is seconds from the clip's LOCAL start — the same timeline
 * the keyframes live on. Returns null for a constant envelope.
 */
export function volumeEnvelopeExpr(points: VolumeEnvelopePoint[]): string | null {
  if (points.length < 2 || envelopeIsConstant(points)) return null;
  let expr = fmt(points[0].v);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dt = b.tS - a.tS;
    if (dt <= 0) continue;
    const slope = (b.v - a.v) / dt;
    if (Math.abs(slope) < 1e-6) continue;
    const seg = `(min(t,${fmt(b.tS)})-min(t,${fmt(a.tS)}))`;
    expr += slope < 0 ? `-${fmt(-slope)}*${seg}` : `+${fmt(slope)}*${seg}`;
  }
  return expr;
}

/**
 * Evaluate the envelope exactly as the expression does — the same sum of
 * clamped segment ramps. The parity spec compares this against the preview's
 * direct interpolation.
 */
export function volumeEnvelopeValueAt(
  points: VolumeEnvelopePoint[],
  tS: number
): number {
  let v = points[0].v;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dt = b.tS - a.tS;
    if (dt <= 0) continue;
    const slope = (b.v - a.v) / dt;
    if (Math.abs(slope) < 1e-6) continue;
    v += slope * (Math.min(tS, b.tS) - Math.min(tS, a.tS));
  }
  return v;
}
