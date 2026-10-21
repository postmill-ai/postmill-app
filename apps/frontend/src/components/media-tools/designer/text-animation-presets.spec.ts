import { describe, it, expect } from 'vitest';
import {
  TEXT_ANIMATION_PRESETS,
  TYPEWRITER_MS_PER_CHAR,
  buildTextAnimationUpdate,
  matchTextAnimationPreset,
} from './text-animation-presets';

const presetByName = (name: string) => {
  const preset = TEXT_ANIMATION_PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`preset ${name} not found`);
  return preset;
};

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
      { tMs: 0, props: { opacity: 0 }, ease: 'easeOut' as const },
      { tMs: 400, props: { opacity: 1 }, ease: 'easeOut' as const },
    ];
    expect(matchTextAnimationPreset(keyframes, 50, 60)).toBe('Pop');
  });

  it('Typewriter matches on textReveal, not keyframes', () => {
    // The reveal preset writes textReveal and clears the lanes — the clip must
    // still highlight Typewriter, and the old opacity ramp must match nothing.
    expect(
      matchTextAnimationPreset([], 0, 0, 0, { mode: 'chars', durationMs: 800 })
    ).toBe('Typewriter');
    expect(
      matchTextAnimationPreset(undefined, 0, 0, 0, { mode: 'words' })
    ).toBeNull(); // no words preset exists
    expect(
      matchTextAnimationPreset(
        [
          { tMs: 0, props: { opacity: 0 }, ease: 'easeInOut' as const },
          { tMs: 300, props: { opacity: 1 }, ease: 'easeInOut' as const },
        ],
        0,
        0
      )
    ).toBeNull(); // the pre-reveal Typewriter ramp matches no preset anymore
  });

  it('a reveal with keyframes still present does not match (half-applied state)', () => {
    expect(
      matchTextAnimationPreset(
        [{ tMs: 0, props: { opacity: 0 } }],
        0,
        0,
        0,
        { mode: 'chars' }
      )
    ).toBeNull();
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
    const clip = { x: 320, y: 480, rotation: 5, text: 'Hello there', startMs: 0, endMs: 5000 };
    for (const preset of TEXT_ANIMATION_PRESETS) {
      const update = buildTextAnimationUpdate(preset, clip);
      expect(
        matchTextAnimationPreset(update.keyframes, clip.x, clip.y, clip.rotation, update.textReveal)
      ).toBe(preset.name);
    }
  });
});

describe('buildTextAnimationUpdate', () => {
  it('shifts relative props onto the clip base transform', () => {
    const update = buildTextAnimationUpdate(presetByName('Fade Up'), {
      x: 100,
      y: 200,
      rotation: 0,
      startMs: 0,
      endMs: 5000,
    });
    expect(update.keyframes).toEqual([
      { tMs: 0, props: { y: 220, opacity: 0 }, ease: 'easeOut' },
      { tMs: 500, props: { y: 200, opacity: 1 }, ease: 'easeOut' },
    ]);
    // A keyframe preset clears any reveal the clip carried.
    expect(update.textReveal).toBeUndefined();
  });

  it('Typewriter writes a per-char paced reveal and clears the keyframe lanes', () => {
    const update = buildTextAnimationUpdate(presetByName('Typewriter'), {
      x: 0,
      y: 0,
      rotation: 0,
      text: 'Hello there', // 11 chars
      startMs: 0,
      endMs: 10000,
    });
    expect(update.keyframes).toEqual([]);
    expect(update.textReveal).toEqual({
      mode: 'chars',
      durationMs: 11 * TYPEWRITER_MS_PER_CHAR,
    });
  });

  it('clamps the reveal window at the clip duration (short clip, long text)', () => {
    const update = buildTextAnimationUpdate(presetByName('Typewriter'), {
      x: 0,
      y: 0,
      rotation: 0,
      text: 'x'.repeat(100), // 8000ms of pacing into a 2000ms clip
      startMs: 500,
      endMs: 2500,
    });
    expect(update.textReveal?.durationMs).toBe(2000);
  });

  it('omits durationMs for an empty text (the reveal then spans the clip)', () => {
    const update = buildTextAnimationUpdate(presetByName('Typewriter'), {
      x: 0,
      y: 0,
      rotation: 0,
      text: '',
      startMs: 0,
      endMs: 3000,
    });
    expect(update.textReveal).toEqual({ mode: 'chars' });
  });
});
