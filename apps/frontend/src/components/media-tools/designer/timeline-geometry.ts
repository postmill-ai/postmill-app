import { DRAG_SCROLL_EDGE_PX, DRAG_SCROLL_MAX_SPEED_PX } from './panels/drag-auto-scroll';

export const timelineHorizontalScrollDelta = (
  containerLeft: number,
  containerRight: number,
  pointerX: number,
  edgePx: number = DRAG_SCROLL_EDGE_PX,
  maxSpeedPx: number = DRAG_SCROLL_MAX_SPEED_PX
): number => {
  if (pointerX < containerLeft || pointerX > containerRight) return 0;
  const fromLeft = pointerX - containerLeft;
  if (fromLeft < edgePx) {
    return -Math.max(1, Math.round(maxSpeedPx * (1 - fromLeft / edgePx)));
  }
  const fromRight = containerRight - pointerX;
  if (fromRight < edgePx) {
    return Math.max(1, Math.round(maxSpeedPx * (1 - fromRight / edgePx)));
  }
  return 0;
};

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
