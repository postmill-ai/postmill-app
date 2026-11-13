import type { VideoClip } from './designer.store';

export const MIN_TRANSITION_CLIP_WIDTH_PX = 24;
export const TRANSITION_BADGE_WIDTH_PX = 24;
export const TRANSITION_BADGE_HEIGHT_PX = 16;
export const TRANSITION_BADGE_TOP_PX = 0;
export const CLIP_TOP_PX = 20;

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
    const hasTransition = !!from.transitionOut || !!to.transitionIn;
    const wideEnough =
      fromWidth >= MIN_TRANSITION_CLIP_WIDTH_PX &&
      toWidth >= MIN_TRANSITION_CLIP_WIDTH_PX;
    if (from.endMs <= to.startMs && (wideEnough || hasTransition)) {
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
