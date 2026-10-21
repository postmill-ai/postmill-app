import type { VideoClip, VideoTrack } from './designer.store';

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

/**
 * Cross-track drops are only legal between tracks of the same type: the
 * renderers (preview overlay AND server frame script) route drawing by track
 * type, so a video clip on a caption track would render as a caption — i.e.
 * vanish from the export while looking fine in the preview.
 */
export const canDropClipOnTrack = (
  clipTrackType: VideoTrack['type'],
  targetTrackType: VideoTrack['type'],
): boolean => clipTrackType === targetTrackType;

/**
 * Overlap-free placement on a track.
 *
 * Same-track overlap is legal in the document model (the renderer composites
 * by startMs), but it is almost never what a drag or an insert MEANT — the
 * clip vanishes behind another one. `resolveClipPlacement` takes the proposed
 * interval and the track's existing clips and returns either the proposal
 * unchanged (it fits), the nearest free gap edge when the shift stays within
 * `snapThresholdMs`, or null (no room — the caller reverts or picks another
 * track). Passing threshold 0 is the strict "is this window free" test, used
 * by find-or-create-track landing.
 *
 * Intervals touching at an edge (`a.endMs === b.startMs`) do NOT overlap.
 */
export interface ClipInterval {
  startMs: number;
  endMs: number;
  /** A clip is never its own obstacle: the dragged clip matches by id. */
  clipId?: string;
}

export const resolveClipPlacement = (
  clips: ClipInterval[],
  proposed: ClipInterval,
  snapThresholdMs = 0,
  maxEndMs?: number
): { startMs: number; endMs: number } | null => {
  const duration = proposed.endMs - proposed.startMs;
  if (duration <= 0) return null;
  const obstacles = clips
    .filter(
      (c) =>
        c.endMs > c.startMs &&
        // Self-exclusion only when the proposal actually names a clip — two
        // id-less intervals must still collide.
        !(proposed.clipId !== undefined && c.clipId === proposed.clipId)
    )
    .sort((a, b) => a.startMs - b.startMs);
  const collides = (startMs: number, endMs: number) =>
    obstacles.some((c) => startMs < c.endMs && endMs > c.startMs);
  const inBounds = (startMs: number, endMs: number) =>
    startMs >= 0 && (maxEndMs === undefined || endMs <= maxEndMs);

  if (!collides(proposed.startMs, proposed.endMs)) {
    return inBounds(proposed.startMs, proposed.endMs)
      ? { startMs: proposed.startMs, endMs: proposed.endMs }
      : null;
  }

  // The proposal overlaps. Candidate placements sit flush against gap edges:
  // right after or right before each obstacle, plus the timeline origin.
  let best: { startMs: number; shift: number } | null = null;
  for (const startMs of [
    0,
    ...obstacles.flatMap((c) => [c.endMs, c.startMs - duration]),
  ]) {
    const endMs = startMs + duration;
    if (!inBounds(startMs, endMs) || collides(startMs, endMs)) continue;
    const shift = Math.abs(startMs - proposed.startMs);
    if (shift <= snapThresholdMs && (!best || shift < best.shift)) {
      best = { startMs, shift };
    }
  }
  return best ? { startMs: best.startMs, endMs: best.startMs + duration } : null;
};

/**
 * A clip being dropped on another track: its mousedown geometry (`orig*`, for
 * reverts) plus the CURRENT (already dragged) timing that the drop proposes.
 */
export interface TrackDropMember {
  trackId: string;
  clipId: string;
  origStart: number;
  origEnd: number;
  startMs: number;
  endMs: number;
}

export interface PlannedTrackMove {
  trackId: string;
  clipId: string;
  toTrackId: string;
  startMs: number;
  endMs: number;
}

/**
 * Plan a cross-track drop.
 *
 * The vertical delta from the dragged clip's track to the hovered track is
 * applied to EVERY member (group drags move whole rows), so the plan is null
 * when any member's target row does not exist, is locked, or is type-
 * mismatched (`canDropClipOnTrack` — the renderers route by track type).
 *
 * Unless `allowOverlap` (Alt), each member's landing window is collision-
 * resolved against its target track via `resolveClipPlacement`; a member with
 * no room rejects the whole plan (the caller reverts the drag) rather than
 * dropping half a group.
 */
export const planTrackDrop = (
  tracks: VideoTrack[],
  members: TrackDropMember[],
  sourceTrackId: string,
  hoveredTrackId: string,
  opts: { snapThresholdMs: number; maxEndMs: number; allowOverlap?: boolean }
): PlannedTrackMove[] | null => {
  if (!members.length) return null;
  const indexOf = new Map(tracks.map((t, i) => [t.id, i] as const));
  const sourceIdx = indexOf.get(sourceTrackId);
  const hoveredIdx = indexOf.get(hoveredTrackId);
  if (sourceIdx === undefined || hoveredIdx === undefined) return null;
  const delta = hoveredIdx - sourceIdx;
  if (delta === 0) return null;

  const memberIds = new Set(members.map((m) => m.clipId));
  const moves: PlannedTrackMove[] = [];
  for (const m of members) {
    const srcTrack = tracks[indexOf.get(m.trackId) ?? -1];
    const target = tracks[(indexOf.get(m.trackId) ?? -1) + delta];
    if (!srcTrack || !target || target.locked) return null;
    if (!canDropClipOnTrack(srcTrack.type, target.type)) return null;
    let { startMs, endMs } = m;
    if (!opts.allowOverlap) {
      const resolved = resolveClipPlacement(
        target.clips
          .filter((c) => !memberIds.has(c.id))
          .map((c) => ({ startMs: c.startMs, endMs: c.endMs, clipId: c.id })),
        { startMs, endMs, clipId: m.clipId },
        opts.snapThresholdMs,
        opts.maxEndMs
      );
      if (!resolved) return null;
      ({ startMs, endMs } = resolved);
    }
    moves.push({ trackId: m.trackId, clipId: m.clipId, toTrackId: target.id, startMs, endMs });
  }
  return moves;
};

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
