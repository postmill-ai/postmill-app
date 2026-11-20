import type { VideoTrack } from './designer.store';
import { timelineRowTops, type TimelineRowGeometry } from './timeline-geometry';

/**
 * Rubber-band (marquee) selection on the video timeline.
 *
 * The marquee rect lives in SCROLL-CONTENT coordinates (x grows with the
 * timeline width, y grows down past the ruler), so it is immune to scrolling
 * mid-drag. Hit-testing shares `timelineRowTops` with video-timeline.tsx,
 * including compact and collapsed row heights. A clip spans
 * `labelWidth + [startMs, effectiveEnd] * pixelsPerMs` horizontally
 * (effectiveEnd includes the freeze-hold extension).
 */

export interface MarqueeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MarqueeGeometry extends TimelineRowGeometry {
  labelWidth: number;
  collapsedTrackIds?: ReadonlySet<string>;
}

export const normalizeMarquee = (
  x0: number,
  y0: number,
  x1: number,
  y1: number
): MarqueeRect => ({
  left: Math.min(x0, x1),
  right: Math.max(x0, x1),
  top: Math.min(y0, y1),
  bottom: Math.max(y0, y1),
});

/** A drag below this size is a click on empty track area, not a selection. */
export const MARQUEE_CLICK_SLOP_PX = 4;

export const isMarqueeClick = (rect: MarqueeRect): boolean =>
  rect.right - rect.left < MARQUEE_CLICK_SLOP_PX &&
  rect.bottom - rect.top < MARQUEE_CLICK_SLOP_PX;

export const marqueeHitClips = (
  tracks: VideoTrack[],
  rect: MarqueeRect,
  pixelsPerMs: number,
  geom: MarqueeGeometry
): { trackId: string; clipId: string }[] => {
  const hits: { trackId: string; clipId: string }[] = [];
  const rowTops = timelineRowTops(tracks.length, geom);
  tracks.forEach((track, ti) => {
    if (geom.collapsedTrackIds?.has(track.id)) return;
    const rowTop = rowTops[ti];
    const rowBottom = rowTop + (geom.trackHeights?.[ti] ?? geom.trackHeight) + geom.trackGap;
    if (rect.bottom < rowTop || rect.top > rowBottom) return;
    for (const clip of track.clips) {
      const left = geom.labelWidth + clip.startMs * pixelsPerMs;
      const right = geom.labelWidth + (clip.endMs + (clip.freezeAtMs || 0)) * pixelsPerMs;
      if (left <= rect.right && right >= rect.left) {
        hits.push({ trackId: track.id, clipId: clip.id });
      }
    }
  });
  return hits;
};
