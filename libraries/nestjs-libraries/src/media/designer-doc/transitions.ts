/**
 * Clip transitions — the per-frame maths both video renderers share.
 *
 * The canvas preview imports these; the video frame renderer, which runs in a
 * headless page and cannot import, is handed the same functions as source (see
 * `transitionsSource`) — the same parity discipline as `keyframes.ts` and
 * `speed-curve.ts`. A hand-written second copy is how an exported mp4 ends up
 * transitioning differently from the preview it was authored in.
 *
 * Semantics (progress p runs 0 → 1 across the overlap window):
 * - `cut`      — no overlap; an outgoing clip caught in the window draws nothing.
 * - `fade`     — fade-THROUGH-BLACK: the outgoing clip is gone by p=0.5, the
 *                incoming only appears from p=0.5 (never a cross-mix).
 * - `dissolve` — the plain cross-fade: inverse linear opacity ramps.
 * - `slide`    — cross-fade plus both clips offset along `direction`.
 * - `wipe`     — the incoming clip slides in over a STATIC outgoing one (no
 *                opacity ramp), covering it along `direction`.
 * - `zoom`     — cross-fade while the incoming clip grows into place and the
 *                outgoing one grows past the frame (scale about the centre).
 * - `blur`     — cross-fade plus a gaussian blur ramp, sharpest at the clip's
 *                own end of the window (applied via the canvas/CSS filter
 *                pipeline in both renderers).
 *
 * This module must stay dependency-free: its functions are stringified into
 * the injected frame-renderer script.
 */

export type ClipTransitionType =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'slide'
  | 'wipe'
  | 'zoom'
  | 'blur';

export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/** Peak blur radius (logical px) at the weak end of a blur transition. */
export const TRANSITION_MAX_BLUR_PX = 24;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export interface TransitionAdjustment {
  /** Multiplies the clip's own opacity. */
  opacityFactor: number;
  /** Pixel offsets applied to the clip's box. */
  dx: number;
  dy: number;
  /** Uniform scale applied to the clip's box about its centre. */
  scale: number;
  /** Gaussian blur radius in logical px (0 = none). */
  blurPx: number;
}

/**
 * The render adjustment for one clip inside a transition window. `width` /
 * `height` are the clip's current box size — slide/wipe offsets are measured
 * in clip box units, exactly as the historic slide implementation did.
 */
export const transitionAdjustment = (
  type: ClipTransitionType | undefined,
  direction: TransitionDirection | undefined,
  progress: number,
  isIncoming: boolean,
  width: number,
  height: number
): TransitionAdjustment => {
  const none: TransitionAdjustment = { opacityFactor: 1, dx: 0, dy: 0, scale: 1, blurPx: 0 };
  if (!type) return none;
  const p = clamp01(progress);

  if (type === 'cut') {
    return { ...none, opacityFactor: isIncoming ? 1 : 0 };
  }
  if (type === 'fade') {
    // Through black: each clip owns half the window, touching at the midpoint.
    return {
      ...none,
      opacityFactor: isIncoming ? Math.max(0, p * 2 - 1) : 1 - Math.min(1, p * 2),
    };
  }

  const crossfade = isIncoming ? p : 1 - p;

  if (type === 'dissolve') {
    return { ...none, opacityFactor: crossfade };
  }
  if (type === 'slide') {
    const offset = (isIncoming ? 1 - p : p) * (width || 1);
    const adj: TransitionAdjustment = { ...none, opacityFactor: crossfade };
    const dir = direction || 'left';
    if (dir === 'left') adj.dx = -offset;
    else if (dir === 'right') adj.dx = offset;
    else if (dir === 'up') adj.dy = -offset;
    else adj.dy = offset;
    return adj;
  }
  if (type === 'wipe') {
    // Incoming covers the outgoing along the direction; outgoing stays put.
    if (!isIncoming) return none;
    const dir = direction || 'left';
    const adj: TransitionAdjustment = { ...none };
    if (dir === 'left') adj.dx = -(1 - p) * (width || 1);
    else if (dir === 'right') adj.dx = (1 - p) * (width || 1);
    else if (dir === 'up') adj.dy = -(1 - p) * (height || 1);
    else adj.dy = (1 - p) * (height || 1);
    return adj;
  }
  if (type === 'zoom') {
    return {
      ...none,
      opacityFactor: crossfade,
      scale: isIncoming ? 0.6 + 0.4 * p : 1 + 0.4 * p,
    };
  }
  if (type === 'blur') {
    return {
      ...none,
      opacityFactor: crossfade,
      blurPx: (isIncoming ? 1 - p : p) * TRANSITION_MAX_BLUR_PX,
    };
  }
  return none;
};

interface TransitionPropsLike {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

/**
 * Fold an adjustment into a clip's interpolated props. Returns a new props
 * object; `blurPx` rides along as an extra key the renderers read (Konva
 * ignores unknown props — the preview only maps the fields it knows).
 */
export const applyTransitionAdjustment = <T extends TransitionPropsLike>(
  props: T,
  adj: TransitionAdjustment
): T & { blurPx: number } => {
  const scale = adj.scale;
  const cx = props.x + props.width / 2;
  const cy = props.y + props.height / 2;
  const width = props.width * scale;
  const height = props.height * scale;
  return {
    ...props,
    x: cx - width / 2 + adj.dx,
    y: cy - height / 2 + adj.dy,
    width,
    height,
    opacity: clamp01(props.opacity * adj.opacityFactor),
    blurPx: adj.blurPx,
  };
};

/**
 * These same functions as JavaScript source, for the injected frame renderer.
 * Everything the exported functions close over is included, so the block is
 * self-contained and can simply be prepended to a script.
 */
export const transitionsSource = (): string => {
  const decl = (name: string, value: unknown) => `const ${name} = ${String(value)};`;
  return [
    `const TRANSITION_MAX_BLUR_PX = ${JSON.stringify(TRANSITION_MAX_BLUR_PX)};`,
    decl('clamp01', clamp01),
    decl('transitionAdjustment', transitionAdjustment),
    decl('applyTransitionAdjustment', applyTransitionAdjustment),
  ].join('\n');
};
