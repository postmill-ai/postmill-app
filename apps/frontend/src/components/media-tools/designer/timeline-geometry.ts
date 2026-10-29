export interface TimelineRowGeometry {
  rulerHeight: number;
  trackHeight: number;
  trackGap: number;
}

export const timelineTrackIndexAtClientY = (
  clientY: number,
  viewportTop: number,
  scrollTop: number,
  geometry: TimelineRowGeometry
): number => {
  const contentY = clientY - viewportTop + scrollTop - geometry.rulerHeight;
  return Math.floor(contentY / (geometry.trackHeight + geometry.trackGap));
};

export const timelineTrackAtClientY = <T>(
  tracks: T[],
  clientY: number,
  viewportTop: number,
  scrollTop: number,
  geometry: TimelineRowGeometry
): T | undefined => {
  const index = timelineTrackIndexAtClientY(clientY, viewportTop, scrollTop, geometry);
  return index >= 0 && index < tracks.length ? tracks[index] : undefined;
};

export const timelineIsNewTrackZone = (
  trackCount: number,
  maxTracks: number,
  clientY: number,
  viewportTop: number,
  scrollTop: number,
  geometry: TimelineRowGeometry
): boolean =>
  trackCount < maxTracks &&
  timelineTrackIndexAtClientY(clientY, viewportTop, scrollTop, geometry) === trackCount;

const boundedScreenThreshold = (
  pixelsPerMs: number,
  screenPx: number,
  maxMs: number
): number => Math.max(1, Math.min(maxMs, screenPx / Math.max(0.0001, pixelsPerMs)));

export const timelineSnapThresholdMs = (pixelsPerMs: number): number =>
  boundedScreenThreshold(pixelsPerMs, 6, 100);

export const timelineCollisionToleranceMs = (pixelsPerMs: number): number =>
  boundedScreenThreshold(pixelsPerMs, 2, 40);

export const moveClipPreservingDuration = (
  clip: { startMs: number; endMs: number },
  deltaMs: number,
  durationMs: number
): { startMs: number; endMs: number } => {
  const clipDuration = clip.endMs - clip.startMs;
  const startMs = Math.round(
    Math.max(0, Math.min(durationMs - clipDuration, clip.startMs + deltaMs))
  );
  return { startMs, endMs: Math.round(startMs + clipDuration) };
};
