import type { VideoOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

export const MIN_SPLIT_SIDE_MS = 100;

export const canSplitClipAt = (
  output: VideoOutput | undefined,
  trackId: string,
  clipId: string,
  atMs: number
): boolean => {
  const track = output?.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.locked) return false;
  const clip = track.clips.find((candidate) => candidate.id === clipId);
  return !!clip &&
    Number.isFinite(atMs) &&
    atMs >= clip.startMs + MIN_SPLIT_SIDE_MS &&
    atMs <= clip.endMs - MIN_SPLIT_SIDE_MS;
};
