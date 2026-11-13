import { describe, expect, it } from 'vitest';
import type { VideoClip } from './designer.store';
import {
  CLIP_TOP_PX,
  MIN_TRANSITION_CLIP_WIDTH_PX,
  touchingTransitionPairs,
  transitionBadgeGeometry,
} from './timeline-transitions';

const clip = (id: string, startMs: number, endMs: number): VideoClip => ({
  id,
  startMs,
  endMs,
  x: 0,
  y: 0,
  width: 100,
  height: 40,
});

describe('timeline transition geometry', () => {
  it('pairs only touching clips and omits gaps, overlaps, and tiny rendered clips', () => {
    const clips = [
      clip('touching-a', 0, 1000),
      clip('touching-b', 1000, 2000),
      clip('gap-a', 3000, 4000),
      clip('gap-b', 4500, 5500),
      clip('tiny-a', 6000, 6100),
      clip('tiny-b', 6100, 7000),
      clip('overlap-a', 8000, 9000),
      clip('overlap-b', 8500, 9500),
    ];

    expect(touchingTransitionPairs(clips, 0.1).map(({ from, to }) => [from.id, to.id]))
      .toEqual([['touching-a', 'touching-b']]);
    expect(100 * 0.1).toBeLessThan(MIN_TRANSITION_CLIP_WIDTH_PX);
  });

  it('anchors the pointer badge wholly above the clip and both full-height trim edges', () => {
    const badge = transitionBadgeGeometry(200);
    expect(badge.left).toBe(192);
    expect(badge.width).toBe(16);
    expect(badge.top + badge.height).toBeLessThanOrEqual(CLIP_TOP_PX);
  });
});
