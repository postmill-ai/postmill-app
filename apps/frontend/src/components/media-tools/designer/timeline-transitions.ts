import type { VideoClip } from './designer.store';

export const MIN_TRANSITION_CLIP_WIDTH_PX = 24;
export const TRANSITION_BADGE_WIDTH_PX = 16;
export const TRANSITION_BADGE_HEIGHT_PX = 12;
export const TRANSITION_BADGE_TOP_PX = -8;
export const CLIP_TOP_PX = 4;

export const touchingTransitionPairs = (
  clips: VideoClip[],
  pixelsPerMs: number
): { from: VideoClip; to: VideoClip }[] => {
  const sorted = [...clips].sort((a, b) => a.startMs - b.startMs);
  const pairs: { from: VideoClip; to: VideoClip }[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const from = sorted[index];
    const to = sorted[index + 1];
    const fromWidth = (from.endMs + (from.freezeAtMs || 0) - from.startMs) * pixelsPerMs;
    const toWidth = (to.endMs + (to.freezeAtMs || 0) - to.startMs) * pixelsPerMs;
    if (
      from.endMs === to.startMs &&
      fromWidth >= MIN_TRANSITION_CLIP_WIDTH_PX &&
      toWidth >= MIN_TRANSITION_CLIP_WIDTH_PX
    ) {
      pairs.push({ from, to });
    }
  }
  return pairs;
};

export const transitionBadgeGeometry = (handleX: number) => ({
  left: handleX - TRANSITION_BADGE_WIDTH_PX / 2,
  top: TRANSITION_BADGE_TOP_PX,
  width: TRANSITION_BADGE_WIDTH_PX,
  height: TRANSITION_BADGE_HEIGHT_PX,
});
