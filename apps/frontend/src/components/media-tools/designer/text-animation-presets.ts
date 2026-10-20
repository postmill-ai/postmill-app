import type { VideoClip } from './designer.store';
import type { EaseType } from './video-preview';

export interface TextAnimationPreset {
  /** Stable identifier/value — persisted on the clip and used for matching. Never translate. */
  name: string;
  /** i18n key for the display label — the `name` above stays the canonical stored value. */
  nameKey: string;
  keyframes: VideoClip['keyframes'];
}

/**
 * Keyframe props the apply handler treats as RELATIVE to the clip's base
 * transform (preset value + clip's current x/y/rotation). Everything else
 * (opacity, …) is absolute.
 */
export const TEXT_ANIM_RELATIVE_PROPS = new Set(['x', 'y', 'rotation']);

export const TEXT_ANIMATION_PRESETS: TextAnimationPreset[] = [
  {
    name: 'Typewriter',
    nameKey: 'designer_text_anim_typewriter',
    keyframes: [
      { tMs: 0, props: { opacity: 0 }, ease: 'easeInOut' as EaseType },
      { tMs: 300, props: { opacity: 1 }, ease: 'easeInOut' as EaseType },
    ],
  },
  {
    name: 'Pop',
    nameKey: 'designer_text_anim_pop',
    keyframes: [
      { tMs: 0, props: { opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 400, props: { opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Fade Up',
    nameKey: 'designer_text_anim_fade_up',
    keyframes: [
      { tMs: 0, props: { y: 20, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { y: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Fade Down',
    nameKey: 'designer_text_anim_fade_down',
    keyframes: [
      { tMs: 0, props: { y: -20, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { y: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Slide In Left',
    nameKey: 'designer_text_anim_slide_in_left',
    keyframes: [
      { tMs: 0, props: { x: -60, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { x: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Slide In Right',
    nameKey: 'designer_text_anim_slide_in_right',
    keyframes: [
      { tMs: 0, props: { x: 60, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { x: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Rotate In',
    nameKey: 'designer_text_anim_rotate_in',
    keyframes: [
      { tMs: 0, props: { rotation: -12, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { rotation: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Bounce Up',
    nameKey: 'designer_text_anim_bounce_up',
    keyframes: [
      { tMs: 0, props: { y: 30, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 350, props: { y: -6, opacity: 1 }, ease: 'easeOut' as EaseType },
      { tMs: 550, props: { y: 0, opacity: 1 }, ease: 'easeInOut' as EaseType },
    ],
  },
];

/**
 * Which preset (if any) a clip's keyframes currently match, given the clip's
 * base transform — relative props are compared as base + offset. Drives the
 * active-state highlight on the preset buttons, so applying a preset gives
 * visual acknowledgment even before playback shows it.
 */
export const matchTextAnimationPreset = (
  keyframes: VideoClip['keyframes'] | undefined,
  baseX: number,
  baseY: number,
  baseRotation = 0
): string | null => {
  if (!keyframes?.length) return null;
  outer: for (const preset of TEXT_ANIMATION_PRESETS) {
    const pk = preset.keyframes ?? [];
    if (pk.length !== keyframes.length) continue;
    for (let i = 0; i < pk.length; i++) {
      if (pk[i].tMs !== keyframes[i].tMs) continue outer;
      const expected: Record<string, number> = {};
      for (const [k, v] of Object.entries(pk[i].props)) {
        expected[k] =
          k === 'x'
            ? baseX + v
            : k === 'y'
              ? baseY + v
              : k === 'rotation'
                ? baseRotation + v
                : v;
      }
      const actual = keyframes[i].props;
      const keys = Object.keys(expected);
      if (keys.length !== Object.keys(actual).length) continue outer;
      for (const k of keys) {
        const v = actual[k];
        // NaN-safe: a missing key must reject, and NaN never compares > eps.
        if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v - expected[k]) > 0.01)
          continue outer;
      }
    }
    return preset.name;
  }
  return null;
};
