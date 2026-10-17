import type { VideoClip } from './designer.store';

// Mirror of the server cap (VideoSegmentTransformService.MAX_SEGMENT_SPAN_MS) so
// the dialog can reject an over-long segment before the round-trip.
export const MAX_SEGMENT_SPAN_MS = 30_000;

// splitClip refuses cut points within 100 ms of a clip edge.
const SPLIT_EDGE_GUARD_MS = 100;

/** Clip-relative segment window (ms from the clip's startMs). */
export interface SegmentWindow {
  startMs: number;
  endMs: number;
}

// Playhead-centered window (default 2 s) clamped to the clip bounds.
export function defaultSegmentWindow(
  clipDurationMs: number,
  playheadOffsetMs: number,
  windowMs = 2000,
): SegmentWindow {
  const span = Math.min(windowMs, clipDurationMs);
  const startMs = Math.max(0, Math.min(playheadOffsetMs - windowMs / 2, clipDurationMs - span));
  return { startMs: Math.round(startMs), endMs: Math.round(startMs + span) };
}

export function isWholeClipWindow(window: SegmentWindow, clipDurationMs: number): boolean {
  return window.startMs <= 0 && window.endMs >= clipDurationMs;
}

export function isValidSegmentWindow(window: SegmentWindow, clipDurationMs: number): boolean {
  return (
    window.startMs >= 0 &&
    window.endMs <= clipDurationMs &&
    window.endMs - window.startMs >= SPLIT_EDGE_GUARD_MS &&
    window.endMs - window.startMs <= MAX_SEGMENT_SPAN_MS
  );
}

/**
 * Map a clip-relative window to SOURCE-time trim bounds for the server. The
 * clip's playback rate stretches/shrinks source time (sourceTimeForPlayhead
 * multiplies by speed), so the ffmpeg trim must too.
 */
export function segmentSourceTrim(
  clip: Pick<VideoClip, 'trimInMs' | 'speed'>,
  window: SegmentWindow,
): { trimStartMs: number; trimEndMs: number } {
  const speed = clip.speed ?? 1;
  const trimIn = clip.trimInMs ?? 0;
  return {
    trimStartMs: Math.round(trimIn + window.startMs * speed),
    trimEndMs: Math.round(trimIn + window.endMs * speed),
  };
}

export interface SegmentSplitPlan {
  /** Absolute timeline ms to split at, in application order (start first). */
  startSplitMs: number | null;
  endSplitMs: number | null;
  /** Effective middle-segment bounds after the split edge guards. */
  middleStartMs: number;
  middleEndMs: number;
}

/**
 * Turn a clip-relative window into a split plan. Windows flush with a clip edge
 * (within the 100 ms guard) absorb that edge instead of splitting — a 50 ms
 * sliver before/after the segment would be uneditable anyway.
 */
export function planSegmentSplits(
  clip: Pick<VideoClip, 'startMs' | 'endMs'>,
  window: SegmentWindow,
): SegmentSplitPlan {
  const clipDurationMs = clip.endMs - clip.startMs;
  const wantStart = clip.startMs + window.startMs;
  const wantEnd = clip.startMs + window.endMs;
  const startSplitMs = window.startMs >= SPLIT_EDGE_GUARD_MS ? wantStart : null;
  const endSplitMs = clipDurationMs - window.endMs >= SPLIT_EDGE_GUARD_MS ? wantEnd : null;
  return {
    startSplitMs,
    endSplitMs,
    middleStartMs: startSplitMs ?? clip.startMs,
    middleEndMs: endSplitMs ?? clip.endMs,
  };
}

/**
 * After the planned splits ran, the middle segment is the clip matching the
 * planned bounds. Split points are placed exactly at the requested ms (the
 * guard absorption above keeps them clear of splitClip's clamp), so an exact
 * match is safe.
 */
export function findMiddleClipId<T extends { id: string; startMs: number; endMs: number }>(
  clips: T[],
  plan: SegmentSplitPlan,
): string | null {
  return (
    clips.find((c) => c.startMs === plan.middleStartMs && c.endMs === plan.middleEndMs)?.id ?? null
  );
}
