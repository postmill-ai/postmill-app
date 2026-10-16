import type { VideoClip } from './designer.store';

/**
 * Writing a canvas drag or resize back onto a video clip.
 *
 * A clip's on-screen box is not `clip.x/y/width/height` — it is whatever
 * `interpolateKeyframes` produced for the current playhead. So a gesture is
 * applied as a DELTA against the rendered box, never as an absolute value, or
 * dragging an animated clip would collapse its animation onto the frame that
 * happened to be showing.
 *
 * Where the delta lands depends on the playhead:
 *
 * - a keyframe sitting exactly under the playhead is the thing the user can see
 *   and is therefore the thing they are dragging — move that keyframe;
 * - otherwise the gesture moves the clip as a whole, which means its base props.
 */

/** Rendered geometry, as produced by `interpolateKeyframes`. */
export interface ClipBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export type ClipGeometry = Partial<
  Pick<VideoClip, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'keyframes'>
>;

/**
 * Timeline edge trims.
 *
 * A video/audio clip shows a WINDOW of its source: `trimInMs` in, lasting
 * `(endMs - startMs) * speed` of source time (see `sourceTimeForPlayhead`).
 * Moving the START edge must therefore advance `trimInMs` by the same (scaled)
 * delta — otherwise the window slides and the head is never actually cut.
 * A reversed clip plays that window backwards, so its edges consume source
 * from the opposite side: the start edge leaves `trimInMs` alone and the end
 * edge pulls it down.
 *
 * The END edge may not extend past the source's duration when that duration is
 * known (probed); image/text/shape clips have no source and skip both rules.
 */
export interface ClipEdgeOptions {
  /** Probed source-media duration in ms, when known. */
  sourceDurationMs?: number;
  /** Only tracks with a real source window (video/audio) trim their source. */
  hasSourceWindow: boolean;
  /** Smallest allowed clip length — the timeline/store minimum is 100ms. */
  minDurationMs?: number;
  /** Output duration cap for the end edge. */
  maxEndMs: number;
}

export const clipEdgeUpdate = (
  clip: VideoClip,
  edge: 'start' | 'end',
  proposedMs: number,
  opts: ClipEdgeOptions
): { startMs: number; endMs: number; trimInMs?: number } => {
  const minDuration = opts.minDurationMs ?? 100;
  const trimIn = clip.trimInMs ?? 0;
  // A speed:0 (freeze) clip holds one frame at trimInMs — trimming its edges
  // changes only how long the frame is held, never which frame.
  const speed = clip.speed === 0 ? null : (clip.speed ?? 1);
  const trimmable = opts.hasSourceWindow && speed !== null;

  if (edge === 'start') {
    let startMs = Math.max(0, Math.min(clip.endMs - minDuration, proposedMs));
    if (!trimmable) return { startMs, endMs: clip.endMs };
    if (clip.reverse) {
      // The end frame is anchored; extending left consumes LATER source.
      if (opts.sourceDurationMs !== undefined) {
        const maxWindow = (opts.sourceDurationMs - trimIn) / speed;
        startMs = Math.max(startMs, clip.endMs - maxWindow);
      }
      return { startMs, endMs: clip.endMs };
    }
    let nextTrimIn = trimIn + (startMs - clip.startMs) * speed;
    if (nextTrimIn < 0) {
      // No source before 0: the edge cannot extend further left.
      nextTrimIn = 0;
      startMs = clip.startMs - trimIn / speed;
    }
    return { startMs, endMs: clip.endMs, trimInMs: nextTrimIn };
  }

  let endMs = Math.max(clip.startMs + minDuration, Math.min(opts.maxEndMs, proposedMs));
  if (!trimmable) return { startMs: clip.startMs, endMs };
  if (clip.reverse) {
    // Extending the end shows EARLIER source: trimInMs drops, bottoming at 0.
    const delta = (endMs - clip.endMs) * speed;
    const nextTrimIn = Math.max(0, trimIn - delta);
    endMs = clip.endMs + (trimIn - nextTrimIn) / speed;
    return { startMs: clip.startMs, endMs, trimInMs: nextTrimIn };
  }
  if (opts.sourceDurationMs !== undefined) {
    const maxWindow = (opts.sourceDurationMs - trimIn) / speed;
    endMs = Math.min(endMs, clip.startMs + Math.max(minDuration, maxWindow));
  }
  return { startMs: clip.startMs, endMs };
};

/** Milliseconds of slack when matching a keyframe to the playhead. */
const KEYFRAME_EPSILON = 1;

/** True when a keyframe sits under the playhead, i.e. the gesture edits it. */
export const hasKeyframeAtPlayhead = (
  clip: VideoClip,
  playheadMs: number
): boolean => {
  const relativeMs = Math.max(0, playheadMs - clip.startMs);
  return (clip.keyframes || []).some(
    (kf) => Math.abs(kf.tMs - relativeMs) <= KEYFRAME_EPSILON
  );
};

/**
 * The update for a clip whose rendered box moved from `before` to `after`.
 *
 * Returns `null` when nothing meaningfully changed, so a stray click doesn't
 * push a history entry.
 */
export const clipGeometryUpdate = (
  clip: VideoClip,
  before: ClipBox,
  after: ClipBox,
  playheadMs: number
): ClipGeometry | null => {
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const dw = after.width - before.width;
  const dh = after.height - before.height;
  const dr = after.rotation - before.rotation;

  const moved =
    Math.abs(dx) > 0.01 ||
    Math.abs(dy) > 0.01 ||
    Math.abs(dw) > 0.01 ||
    Math.abs(dh) > 0.01 ||
    Math.abs(dr) > 0.01;
  if (!moved) return null;

  const relativeMs = Math.max(0, playheadMs - clip.startMs);
  const keyframes = clip.keyframes || [];
  const index = keyframes.findIndex(
    (kf) => Math.abs(kf.tMs - relativeMs) <= KEYFRAME_EPSILON
  );

  if (index >= 0) {
    // Edit the keyframe the user is looking at. Props absent from it inherit the
    // base value, so seed from the rendered box before applying the delta.
    const kf = keyframes[index];
    const next = [...keyframes];
    next[index] = {
      ...kf,
      props: {
        ...kf.props,
        x: before.x + dx,
        y: before.y + dy,
        width: before.width + dw,
        height: before.height + dh,
        rotation: before.rotation + dr,
      },
    };
    return { keyframes: next };
  }

  return {
    x: (clip.x ?? 0) + dx,
    y: (clip.y ?? 0) + dy,
    width: Math.max(1, (clip.width ?? before.width) + dw),
    height: Math.max(1, (clip.height ?? before.height) + dh),
    rotation: (clip.rotation ?? 0) + dr,
  };
};
