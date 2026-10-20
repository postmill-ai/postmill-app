import { describe, it, expect } from 'vitest';
import {
  TEXT_ANIMATION_PRESETS,
  matchTextAnimationPreset,
} from './text-animation-presets';

describe('matchTextAnimationPreset', () => {
  it('matches a preset applied at a non-origin base position', () => {
    // 'Fade Up' applied to a clip sitting at (100, 200).
    const keyframes = [
      { tMs: 0, props: { y: 220, opacity: 0 }, ease: 'easeOut' as const },
      { tMs: 500, props: { y: 200, opacity: 1 }, ease: 'easeOut' as const },
    ];
    expect(matchTextAnimationPreset(keyframes, 100, 200)).toBe('Fade Up');
  });

  it('matches presets with absolute-only props regardless of position', () => {
    const keyframes = [
      { tMs: 0, props: { opacity: 0 }, ease: 'easeInOut' as const },
      { tMs: 300, props: { opacity: 1 }, ease: 'easeInOut' as const },
    ];
    expect(matchTextAnimationPreset(keyframes, 50, 60)).toBe('Typewriter');
  });

  it('returns null for unmatched or empty keyframes', () => {
    expect(matchTextAnimationPreset(undefined, 0, 0)).toBeNull();
    expect(matchTextAnimationPreset([], 0, 0)).toBeNull();
    expect(
      matchTextAnimationPreset([{ tMs: 0, props: { opacity: 0.5 } }], 0, 0)
    ).toBeNull();
  });

  it('distinguishes presets that share tMs but differ in props', () => {
    // 'Slide In Left' vs 'Slide In Right' — same timing, opposite x offsets.
    const left = [
      { tMs: 0, props: { x: -60, opacity: 0 } },
      { tMs: 500, props: { x: 0, opacity: 1 } },
    ];
    expect(matchTextAnimationPreset(left, 0, 0)).toBe('Slide In Left');
  });

  it('every preset round-trips through the matcher after the apply transform', () => {
    // Mirror handleApplyTextAnimation's base-relative shift, then match.
    const base = { x: 320, y: 480, rotation: 5 };
    for (const preset of TEXT_ANIMATION_PRESETS) {
      const shifted = (preset.keyframes ?? []).map((kf) => ({
        ...kf,
        props: Object.fromEntries(
          Object.entries(kf.props).map(([key, value]) => [
            key,
            key === 'x'
              ? base.x + value
              : key === 'y'
                ? base.y + value
                : key === 'rotation'
                  ? base.rotation + value
                  : value,
          ])
        ),
      }));
      expect(matchTextAnimationPreset(shifted, base.x, base.y, base.rotation)).toBe(
        preset.name
      );
    }
  });
});
