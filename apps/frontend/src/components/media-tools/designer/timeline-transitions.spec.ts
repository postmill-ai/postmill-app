import { describe, expect, it } from 'vitest';
import type { VideoClip } from './designer.store';
import {
  CLIP_TOP_PX,
  MIN_TRANSITION_CLIP_WIDTH_PX,
  transitionPairs,
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
  it('pairs by the renderer rule, including gaps and fractional flush cuts but not overlaps', () => {
    const tinyWithTransition = clip('tiny-a', 6000, 6100);
    tinyWithTransition.transitionOut = { type: 'fade', durationMs: 100 };
    const fractionalWithTransition = clip('fractional-a', 7000, 7123.57);
    fractionalWithTransition.transitionOut = { type: 'fade', durationMs: 100 };
    const clips = [
      clip('touching-a', 0, 1000),
      clip('touching-b', 1000, 2000),
      clip('gap-a', 3000, 4000),
      clip('gap-b', 4500, 5500),
      tinyWithTransition,
      clip('tiny-b', 6100, 7000),
      fractionalWithTransition,
      clip('fractional-b', 7125, 8000),
      clip('overlap-a', 8000, 9000),
      clip('overlap-b', 8500, 9500),
    ];

    expect(transitionPairs(clips, 0.1).map(({ from, to }) => [from.id, to.id]))
      .toEqual([
        ['touching-a', 'touching-b'],
        ['touching-b', 'gap-a'],
        ['gap-a', 'gap-b'],
        ['tiny-a', 'tiny-b'],
        ['fractional-a', 'fractional-b'],
        ['fractional-b', 'overlap-a'],
      ]);
    expect(100 * 0.1).toBeLessThan(MIN_TRANSITION_CLIP_WIDTH_PX);
  });

  it('omits tiny cut-only pairs while retaining tiny pairs with an existing transition', () => {
    const clips = [clip('tiny-a', 0, 100), clip('tiny-b', 100, 200)];
    expect(transitionPairs(clips, 0.1)).toEqual([]);

    clips[0].transitionOut = { type: 'fade', durationMs: 50 };
    expect(transitionPairs(clips, 0.1)).toHaveLength(1);
  });

  it('anchors the pointer badge in a top lane clear of the ruler and trim edges', () => {
    const badge = transitionBadgeGeometry(200);
    expect(badge.left).toBe(188);
    expect(badge.width).toBe(24);
    expect(badge.top).toBe(0);
    expect(badge.top + badge.height).toBeLessThanOrEqual(CLIP_TOP_PX);
  });
});
