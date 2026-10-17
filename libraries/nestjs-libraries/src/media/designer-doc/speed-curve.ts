/**
 * Speed ramping — CapCut-style variable playback speed within ONE clip.
 *
 * A clip without a `speedCurve` keeps the historic constant-speed mapping:
 * `sourceMs = trimInMs + timelineMs * clip.speed` (mirrored for `reverse`).
 * With a curve (≥2 points), the speed at any clip-local millisecond is
 * piecewise-linearly interpolated between the points and the SOURCE time is
 * the integral of that curve — so this module owns both the interpolation
 * (`speedAt`) and the integration (`sourceTimeForClipTime` / its inverse
 * `clipTimeForSourceTime`), plus the playhead-level wrapper
 * (`sourceTimeForPlayhead`) that both renderers share.
 *
 * The canvas preview imports these; the video frame renderer, which runs in a
 * headless page and cannot import, is handed the same functions as source (see
 * `speedCurveSource`) — the same parity discipline as `keyframes.ts`. A
 * hand-written second copy is how an exported mp4 ends up ramping differently
 * from the preview it was authored in.
 *
 * This module must stay dependency-free: its functions are stringified into
 * the injected frame-renderer script.
 */

/** Schema bounds for any speed value — the same 0.1–10 as `clip.speed`. */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;

export interface SpeedCurvePoint {
  /** ms from the clip's own TIMELINE start (`startMs`), within the clip. */
  atMs: number;
  /** Playback rate multiplier at that moment, 0.1–10. */
  speed: number;
}

/** The clip fields the speed mapping reads — structurally satisfied by VideoClip. */
export interface SpeedClipLike {
  startMs: number;
  endMs: number;
  trimInMs?: number;
  speed?: number;
  reverse?: boolean;
  freezeAtMs?: number;
  speedCurve?: SpeedCurvePoint[];
}

const clampNum = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);

/**
 * Defensive normalisation for evaluation: drop malformed points, clamp into
 * the schema bounds, sort by time. Returns undefined when nothing usable is
 * left, so callers fall back to the constant-speed path.
 */
export const normalizeSpeedCurve = (
  curve?: SpeedCurvePoint[]
): SpeedCurvePoint[] | undefined => {
  if (!curve || curve.length === 0) return undefined;
  const pts = curve
    .filter((p) => p && Number.isFinite(p.atMs) && Number.isFinite(p.speed))
    .map((p) => ({
      atMs: Math.max(0, p.atMs),
      speed: clampNum(p.speed, MIN_SPEED, MAX_SPEED),
    }))
    .sort((a, b) => a.atMs - b.atMs);
  return pts.length ? pts : undefined;
};

/**
 * True when the curve drives the mapping. A single point cannot ramp; it (and
 * anything shorter) leaves the constant `clip.speed` path in charge.
 */
export const hasSpeedCurve = (clip: SpeedClipLike): boolean =>
  (clip.speedCurve?.length ?? 0) >= 2;

/**
 * Piecewise-linear speed at `tMs` (clip-local timeline ms). Holds the first
 * point's speed before it and the last point's speed after it.
 */
export const speedAt = (
  curve: SpeedCurvePoint[] | undefined,
  tMs: number
): number => {
  const pts = normalizeSpeedCurve(curve);
  if (!pts || pts.length === 0) return 1;
  if (tMs <= pts[0].atMs) return pts[0].speed;
  const last = pts[pts.length - 1];
  if (tMs >= last.atMs) return last.speed;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (tMs >= a.atMs && tMs <= b.atMs) {
      const span = b.atMs - a.atMs;
      if (span <= 0) return b.speed;
      const t = (tMs - a.atMs) / span;
      return a.speed + (b.speed - a.speed) * t;
    }
  }
  return last.speed;
};

/**
 * ∫₀^t speedAt(curve, s) ds — the source milliseconds a ramped clip consumes
 * over its first `tMs` timeline milliseconds. Piecewise closed form: each
 * segment's speed is linear, so its integral is the area of a trapezoid
 * (`(sa + sb) / 2 * width` in full, a quadratic in t when cut short).
 */
export const curveIntegratedMs = (
  curve: SpeedCurvePoint[] | undefined,
  tMs: number
): number => {
  const pts = normalizeSpeedCurve(curve);
  if (!pts || pts.length === 0 || tMs <= 0) return 0;
  let acc = 0;
  let prevAt = 0;
  let prevSpeed = pts[0].speed; // constant hold before the first point
  for (const p of pts) {
    if (tMs <= prevAt) return acc;
    const x = Math.min(tMs, p.atMs);
    const width = x - prevAt;
    if (width > 0) {
      // Speed runs linearly from prevSpeed to p.speed over [prevAt, p.atMs].
      const span = p.atMs - prevAt;
      const frac = span > 0 ? width / span : 1;
      const endSpeed = prevSpeed + (p.speed - prevSpeed) * frac;
      acc += ((prevSpeed + endSpeed) / 2) * width;
    }
    prevAt = p.atMs;
    prevSpeed = p.speed;
  }
  if (tMs > prevAt) acc += prevSpeed * (tMs - prevAt); // constant hold after the last point
  return acc;
};

const constantSpeedOf = (clip: SpeedClipLike): number =>
  clip.speed !== undefined && clip.speed !== 0 ? clip.speed : 1;

/**
 * The source-ms a clip shows `localMs` into its own timeline (0 at
 * `startMs`). With a curve this is `trimInMs + ∫ speed`; without one it is
 * EXACTLY the legacy constant-speed math (`localMs * clip.speed`). `reverse`
 * consumes from the tail of the source window: playhead 0 maps to the END of
 * the consumed span, mirroring the constant-speed path's
 * `relativeMs = duration - relativeMs`. A `speed: 0` freeze clip always holds
 * its trim-in frame.
 */
export const sourceTimeForClipTime = (
  clip: SpeedClipLike,
  localMs: number
): number => {
  const trimIn = clip.trimInMs || 0;
  if (clip.speed === 0) return trimIn;
  const duration = Math.max(0, clip.endMs - clip.startMs);
  const t = clampNum(localMs, 0, duration);
  const at = clip.reverse ? duration - t : t;
  const curve = hasSpeedCurve(clip) ? normalizeSpeedCurve(clip.speedCurve) : undefined;
  const consumed = curve
    ? curveIntegratedMs(curve, at)
    : at * constantSpeedOf(clip);
  return trimIn + consumed;
};

/**
 * Inverse of `sourceTimeForClipTime` (minus the trim offset): which clip-local
 * timeline ms shows a given source-ms. Used by anything mapping source→timeline
 * (the audio trim math's source-window length, the inspector's duration
 * recompute). Clamped to the clip's consumed window, so an out-of-range
 * source-ms lands on the nearest clip edge.
 */
export const clipTimeForSourceTime = (
  clip: SpeedClipLike,
  sourceMs: number
): number => {
  if (clip.speed === 0) return 0;
  const duration = Math.max(0, clip.endMs - clip.startMs);
  const trimIn = clip.trimInMs || 0;
  const curve = hasSpeedCurve(clip) ? normalizeSpeedCurve(clip.speedCurve) : undefined;

  if (!curve) {
    const speed = constantSpeedOf(clip);
    const t = clampNum((sourceMs - trimIn) / speed, 0, duration);
    return clip.reverse ? duration - t : t;
  }

  // Total source the clip consumes bounds the inversion.
  const total = curveIntegratedMs(curve, duration);
  const rel = clampNum(sourceMs - trimIn, 0, total);

  // Walk the segments, subtracting whole trapezoids until the target falls
  // inside one, then solve that segment's quadratic (speeds are positive, so
  // the integral is strictly increasing and the root in-range is unique).
  let acc = 0;
  let prevAt = 0;
  let prevSpeed = curve[0].speed;
  let t = duration;
  let solved = false;
  const segments: { a: number; b: number; sa: number; sb: number }[] = [];
  for (const p of curve) {
    segments.push({ a: prevAt, b: p.atMs, sa: prevSpeed, sb: p.speed });
    prevAt = p.atMs;
    prevSpeed = p.speed;
  }
  segments.push({ a: prevAt, b: Number.POSITIVE_INFINITY, sa: prevSpeed, sb: prevSpeed });

  for (const seg of segments) {
    const width = seg.b - seg.a;
    const segArea =
      width === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : ((seg.sa + seg.sb) / 2) * width;
    if (rel > acc + segArea) {
      acc += segArea;
      continue;
    }
    const remaining = rel - acc;
    if (seg.sb === seg.sa) {
      t = seg.a + remaining / seg.sa;
    } else {
      // remaining = sa*x + (sb-sa)*x²/(2*(b-a)) — quadratic in x = t - a.
      const a2 = (seg.sb - seg.sa) / (2 * (seg.b - seg.a));
      const disc = seg.sa * seg.sa + 4 * a2 * remaining;
      t = seg.a + (-seg.sa + Math.sqrt(Math.max(0, disc))) / (2 * a2);
    }
    solved = true;
    break;
  }
  if (!solved) t = duration;
  t = clampNum(t, 0, duration);
  return clip.reverse ? duration - t : t;
};

/**
 * The source time a clip shows at an absolute timeline ms — the ONE mapping
 * both renderers use (the frame page gets it injected via `speedCurveSource`).
 * Returns null outside the clip (freeze tail included in the window).
 */
export const sourceTimeForPlayhead = (
  clip: SpeedClipLike,
  playheadMs: number
): number | null => {
  const effectiveEnd = clip.endMs + (clip.freezeAtMs || 0);
  if (playheadMs < clip.startMs || playheadMs > effectiveEnd) return null;

  // A speed:0 clip is a held (freeze) frame — always the source time at its
  // trim-in, never advancing with the playhead. The curve is ignored there.
  if (clip.speed === 0) return clip.trimInMs || 0;

  const duration = clip.endMs - clip.startMs;
  if (clip.freezeAtMs && playheadMs > clip.endMs) {
    // Freeze tail: hold the last frame. A ramped clip holds the INTEGRATED
    // source end; the constant-speed path keeps its historic
    // `duration + trimIn` so pre-ramp documents render unchanged.
    return hasSpeedCurve(clip)
      ? sourceTimeForClipTime(clip, duration)
      : duration + (clip.trimInMs || 0);
  }

  return sourceTimeForClipTime(clip, playheadMs - clip.startMs);
};

/**
 * The clip's average playback rate over its timeline duration — the single
 * tempo the audio export approximates a ramp with (variable-tempo audio is a
 * separate project), and the rate the preview gives ramped AUDIO elements.
 */
export const averageSpeedForClip = (clip: SpeedClipLike): number => {
  const duration = Math.max(0, clip.endMs - clip.startMs);
  if (!hasSpeedCurve(clip) || clip.speed === 0 || duration <= 0) {
    return constantSpeedOf(clip);
  }
  const consumed = sourceTimeForClipTime(clip, duration) - (clip.trimInMs || 0);
  return clampNum(consumed / duration, MIN_SPEED, MAX_SPEED);
};

export interface SpeedCurveSplit {
  /** Fields to merge onto the clip BEFORE the cut (earlier timeline half). */
  first: { speedCurve: SpeedCurvePoint[]; trimInMs: number };
  /** Fields to merge onto the clip AFTER the cut (later timeline half). */
  second: { speedCurve: SpeedCurvePoint[]; trimInMs: number };
}

/**
 * Split a ramped clip's curve at `splitLocalMs` (clip-local timeline ms),
 * re-basing each side's `atMs` to its own start and fixing each side's
 * `trimInMs` so the source stays continuous across the cut.
 *
 * Direction matters: FORWARD plays the source window head-first, so the first
 * half keeps the curve head and the second half takes the tail plus an
 * advanced trim-in. REVERSE consumes the window from the tail, so the FIRST
 * half plays the later source — it takes the curve tail and the advanced
 * trim-in, and the second half keeps the curve head and the original trim-in.
 * Both sides get an interpolated point AT the cut so the ramp value is
 * continuous there, and both keep ≥2 points (a degenerate side becomes a
 * constant-speed curve at the cut's speed rather than falling back to the
 * clip's stale constant `speed`).
 *
 * Returns null when the clip has no effective curve (or is frozen) — the
 * caller then keeps its legacy split math untouched.
 */
export const splitSpeedCurveForClip = (
  clip: SpeedClipLike,
  splitLocalMs: number
): SpeedCurveSplit | null => {
  if (!hasSpeedCurve(clip) || clip.speed === 0) return null;
  const duration = Math.max(0, clip.endMs - clip.startMs);
  if (duration <= 0) return null;
  const curve = normalizeSpeedCurve(clip.speedCurve)!;
  const local = clampNum(splitLocalMs, 0, duration);
  const trimIn = clip.trimInMs || 0;

  // The cut's position in CURVE time: forward runs 0→duration, reverse mirrors.
  const cutAt = clip.reverse ? duration - local : local;
  const atCut = speedAt(curve, cutAt);
  const beforePts = curve.filter((p) => p.atMs < cutAt);
  const afterPts = curve.filter((p) => p.atMs > cutAt);

  // Head of the curve ([0, cutAt]) and tail ([cutAt, duration], re-based to 0).
  const headCurve: SpeedCurvePoint[] = beforePts.length
    ? [...beforePts, { atMs: cutAt, speed: atCut }]
    : [
        { atMs: 0, speed: atCut },
        { atMs: cutAt, speed: atCut },
      ];
  const tailCurve: SpeedCurvePoint[] = afterPts.length
    ? [
        { atMs: 0, speed: atCut },
        ...afterPts.map((p) => ({ atMs: p.atMs - cutAt, speed: p.speed })),
      ]
    : [
        { atMs: 0, speed: atCut },
        { atMs: Math.max(1, duration - cutAt), speed: atCut },
      ];

  // Source ms where the cut lands — the trim-in of whichever half plays the
  // LATER source window (the second half forward, the first half reversed).
  const laterTrimIn = sourceTimeForClipTime(clip, local);

  return clip.reverse
    ? {
        first: { speedCurve: tailCurve, trimInMs: laterTrimIn },
        second: { speedCurve: headCurve, trimInMs: trimIn },
      }
    : {
        first: { speedCurve: headCurve, trimInMs: trimIn },
        second: { speedCurve: tailCurve, trimInMs: laterTrimIn },
      };
};

/**
 * These same functions as JavaScript source, for the injected frame renderer.
 * Everything the exported functions close over is included, so the block is
 * self-contained and can simply be prepended to a script. Only the render
 * path is injected; the editing helpers (split, average) stay module-side.
 */
export const speedCurveSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const MIN_SPEED = ${JSON.stringify(MIN_SPEED)};`,
    `const MAX_SPEED = ${JSON.stringify(MAX_SPEED)};`,
    decl('clampNum', clampNum),
    decl('normalizeSpeedCurve', normalizeSpeedCurve),
    decl('hasSpeedCurve', hasSpeedCurve),
    decl('speedAt', speedAt),
    decl('curveIntegratedMs', curveIntegratedMs),
    decl('constantSpeedOf', constantSpeedOf),
    decl('sourceTimeForClipTime', sourceTimeForClipTime),
    decl('clipTimeForSourceTime', clipTimeForSourceTime),
    decl('sourceTimeForPlayhead', sourceTimeForPlayhead),
  ].join('\n');
};
