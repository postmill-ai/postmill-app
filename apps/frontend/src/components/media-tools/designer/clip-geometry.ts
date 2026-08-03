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
