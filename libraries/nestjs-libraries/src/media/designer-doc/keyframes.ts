/**
 * Keyframe interpolation — the single place easing is evaluated.
 *
 * The canvas preview imports these; the video frame renderer, which runs in a
 * headless page and cannot import, is handed the same functions as source (see
 * `keyframesSource`). A hand-written second copy is how an exported mp4 ends up
 * easing differently from the preview it was authored in.
 */

/** The four shorthand curves. Their exact formulas are load-bearing: existing
 *  documents animate with them, so they are evaluated as written, not remapped
 *  onto equivalent beziers. */
export type EasePreset = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut';

/**
 * Bezier handles on a keyframe, in normalised segment space (x = time, y =
 * value). A segment uses the OUTgoing handle of the keyframe it leaves and the
 * INcoming handle of the one it arrives at — the pair that the graph editor
 * shows either side of a point.
 */
export interface EaseHandles {
  in?: [number, number];
  out?: [number, number];
}

export type KeyframeEase = EasePreset | EaseHandles;

export interface KeyframeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
}

export interface Keyframe {
  tMs: number;
  props: KeyframeProps;
  ease?: KeyframeEase;
}

/** Neutral handles: the cubic through them is the straight line. */
export const DEFAULT_OUT_HANDLE: [number, number] = [1 / 3, 1 / 3];
export const DEFAULT_IN_HANDLE: [number, number] = [2 / 3, 2 / 3];

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const applyEasePreset = (t: number, ease?: string): number => {
  if (!ease || ease === 'linear') return t;
  if (ease === 'easeInOut') {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  if (ease === 'easeIn') return t * t;
  if (ease === 'easeOut') return 1 - (1 - t) * (1 - t);
  return t;
};

/**
 * Evaluate a cubic bezier with endpoints (0,0) and (1,1) at time `t`.
 *
 * The curve is parametric, so the value at a given TIME needs the parameter s
 * where x(s) = t solved first. Newton converges in a few steps for the
 * monotone-in-x curves a graph editor produces; the bisection fallback keeps a
 * user-dragged handle that makes x non-monotone from spinning.
 */
export const cubicBezierEase = (
  t: number,
  p1: [number, number],
  p2: [number, number]
): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const x1 = p1[0];
  const y1 = p1[1];
  const x2 = p2[0];
  const y2 = p2[1];

  const curve = (a: number, b: number, s: number) => {
    const u = 1 - s;
    return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
  };
  const slope = (a: number, b: number, s: number) => {
    const u = 1 - s;
    return 3 * u * u * a + 6 * u * s * (b - a) + 3 * s * s * (1 - b);
  };

  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = curve(x1, x2, s) - t;
    if (Math.abs(x) < 1e-6) return curve(y1, y2, s);
    const d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) break;
    s -= x / d;
  }

  let lo = 0;
  let hi = 1;
  s = t;
  for (let i = 0; i < 24; i++) {
    const x = curve(x1, x2, s);
    if (Math.abs(x - t) < 1e-6) break;
    if (x < t) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return curve(y1, y2, s);
};

/**
 * The eased progress across one segment.
 *
 * Handles win when either end has them; otherwise the segment falls back to the
 * preset it always used, so documents authored before the graph editor animate
 * exactly as they did.
 */
export const easeSegment = (
  rawT: number,
  prevEase: KeyframeEase | undefined,
  nextEase: KeyframeEase | undefined
): number => {
  const out =
    prevEase && typeof prevEase === 'object' ? prevEase.out : undefined;
  const inn = nextEase && typeof nextEase === 'object' ? nextEase.in : undefined;

  if (out || inn) {
    return cubicBezierEase(rawT, out || DEFAULT_OUT_HANDLE, inn || DEFAULT_IN_HANDLE);
  }

  const preset =
    (typeof nextEase === 'string' ? nextEase : undefined) ||
    (typeof prevEase === 'string' ? prevEase : undefined) ||
    'linear';
  return applyEasePreset(rawT, preset);
};

export interface InterpolatedProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface KeyframedClip extends KeyframeProps {
  keyframes?: Keyframe[];
}

/** The animated transform of a clip at `relativeMs` into its own timeline. */
export const interpolateClipKeyframes = (
  clip: KeyframedClip,
  relativeMs: number
): InterpolatedProps => {
  const defaults: InterpolatedProps = {
    x: clip.x == null ? 0 : clip.x,
    y: clip.y == null ? 0 : clip.y,
    width: clip.width == null ? 1 : clip.width,
    height: clip.height == null ? 1 : clip.height,
    rotation: clip.rotation == null ? 0 : clip.rotation,
    opacity: clip.opacity == null ? 1 : clip.opacity,
  };

  const kfs = clip.keyframes || [];
  if (kfs.length === 0) return defaults;

  const sorted = [...kfs].sort((a, b) => a.tMs - b.tMs);
  const at = (kf: Keyframe): InterpolatedProps => ({
    x: kf.props.x == null ? defaults.x : kf.props.x,
    y: kf.props.y == null ? defaults.y : kf.props.y,
    width: kf.props.width == null ? defaults.width : kf.props.width,
    height: kf.props.height == null ? defaults.height : kf.props.height,
    rotation: kf.props.rotation == null ? defaults.rotation : kf.props.rotation,
    opacity: kf.props.opacity == null ? defaults.opacity : kf.props.opacity,
  });

  if (relativeMs <= sorted[0].tMs) return at(sorted[0]);
  if (relativeMs >= sorted[sorted.length - 1].tMs) return at(sorted[sorted.length - 1]);

  let prev = sorted[0];
  let next = sorted[0];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (relativeMs >= sorted[i].tMs && relativeMs <= sorted[i + 1].tMs) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const range = next.tMs - prev.tMs;
  const rawT = range > 0 ? (relativeMs - prev.tMs) / range : 0;
  const t = easeSegment(rawT, prev.ease, next.ease);

  const a = at(prev);
  const b = at(next);
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    rotation: lerp(a.rotation, b.rotation, t),
    opacity: lerp(a.opacity, b.opacity, t),
  };
};

/**
 * These same functions as JavaScript source, for the injected frame renderer.
 * Everything the exported functions close over is included, so the block is
 * self-contained and can simply be prepended to a script.
 */
export const keyframesSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const DEFAULT_OUT_HANDLE = ${JSON.stringify(DEFAULT_OUT_HANDLE)};`,
    `const DEFAULT_IN_HANDLE = ${JSON.stringify(DEFAULT_IN_HANDLE)};`,
    decl('lerp', lerp),
    decl('applyEasePreset', applyEasePreset),
    decl('cubicBezierEase', cubicBezierEase),
    decl('easeSegment', easeSegment),
    decl('interpolateClipKeyframes', interpolateClipKeyframes),
  ].join('\n');
};
