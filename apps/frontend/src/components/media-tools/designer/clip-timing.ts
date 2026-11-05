import type { VideoClip, VideoTrack } from './designer.store';
import { clipEdgeUpdate, type ClipEdgeOptions } from './clip-geometry';
import { moveClipPreservingDuration } from './timeline-geometry';

export type ClipTimingField = 'start' | 'end' | 'duration';

export const clipTimingUpdate = (
  clip: VideoClip,
  field: ClipTimingField,
  valueMs: number,
  options: ClipEdgeOptions
): { startMs: number; endMs: number; trimInMs?: number } => {
  if (field === 'start') {
    return moveClipPreservingDuration(clip, valueMs - clip.startMs, options.maxEndMs);
  }
  const update = clipEdgeUpdate(
    clip,
    'end',
    field === 'end' ? valueMs : clip.startMs + valueMs,
    options
  );
  return {
    startMs: Math.round(update.startMs),
    endMs: Math.round(update.endMs),
    ...(update.trimInMs !== undefined ? { trimInMs: Math.round(update.trimInMs) } : {}),
  };
};

export const clipTimingTrackOptions = (
  trackType: VideoTrack['type'],
  sourceDurationMs: number | undefined,
  maxEndMs: number
): ClipEdgeOptions => ({
  sourceDurationMs,
  hasSourceWindow: trackType === 'video' || trackType === 'audio',
  maxEndMs,
});
