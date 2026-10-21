import type { VideoClip } from './designer.store';
import type { EaseType } from './video-preview';

export interface TextAnimationPreset {
  /** Stable identifier/value — persisted on the clip and used for matching. Never translate. */
  name: string;
  /** i18n key for the display label — the `name` above stays the canonical stored value. */
  nameKey: string;
  keyframes: VideoClip['keyframes'];
  /**
   * Progressive text reveal instead of transform keyframes (Typewriter):
   * applying it clears the keyframe lanes and writes `clip.textReveal`.
   * Meaningful on text clips only — the inspector hides these presets for
   * shape/image/sticker clips.
   */
  textReveal?: NonNullable<VideoClip['textReveal']>;
}

/**
 * The clip types the inspector's animation presets apply to. The keyframe
 * system is clip-type-agnostic (`interpolateClipKeyframes` animates
 * x/y/rotation/opacity for any clip and both renderers honour it); only the
 * reveal presets stay text-only, since they animate the text content itself.
 */
export const ANIMATION_TRACK_TYPES = new Set(['text', 'shape', 'image', 'sticker']);

/** Typewriter pacing: each character appears every ~80ms of the reveal window. */
export const TYPEWRITER_MS_PER_CHAR = 80;

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
    // A text reveal, not an opacity fade: the string is drawn as a growing
    // prefix (see designer-doc/text-reveal) at ~80ms per character — the old
    // 300ms opacity ramp was indistinguishable from Pop.
    keyframes: [],
    textReveal: { mode: 'chars' },
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
 * The clip patch a preset applies: keyframe props are shifted onto the clip's
 * base transform (relative props only), and a reveal preset writes
 * `textReveal` while CLEARING the keyframe lanes — one animation at a time,
 * so the matcher can never see two presets at once. The Typewriter window is
 * paced per character (~80ms), clamped to the clip so a long text never
 * outruns its own duration.
 */
export const buildTextAnimationUpdate = (
  preset: TextAnimationPreset,
  clip: Pick<VideoClip, 'x' | 'y' | 'rotation' | 'text' | 'startMs' | 'endMs'>
): Pick<VideoClip, 'keyframes' | 'textReveal'> => {
  const base: Record<string, number> = {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    rotation: clip.rotation ?? 0,
  };
  const keyframes = (preset.keyframes ?? [])
    .map((kf) => ({
      ...kf,
      props: Object.fromEntries(
        Object.entries(kf.props).map(([key, value]) => [
          key,
          // Relative props ride on the clip's base transform; omitting a key
          // the preset doesn't animate keeps it out of the keyframe lane.
          TEXT_ANIM_RELATIVE_PROPS.has(key) ? (base[key] ?? 0) + value : value,
        ])
      ),
    }))
    .filter((kf) => Object.keys(kf.props).length > 0);

  let textReveal: VideoClip['textReveal'];
  if (preset.textReveal) {
    const clipDuration = clip.endMs - clip.startMs;
    const chars = (clip.text || '').length;
    const paced = Math.max(1, Math.round(chars * TYPEWRITER_MS_PER_CHAR));
    textReveal = {
      mode: preset.textReveal.mode,
      ...(chars ? { durationMs: Math.min(clipDuration, paced) } : {}),
    };
  }
  return { keyframes, textReveal };
};

/**
 * Which preset (if any) a clip's keyframes currently match, given the clip's
 * base transform — relative props are compared as base + offset. Drives the
 * active-state highlight on the preset buttons, so applying a preset gives
 * visual acknowledgment even before playback shows it.
 *
 * Reveal presets (Typewriter) match on the clip's `textReveal` instead:
 * applying one clears the keyframe lanes, so a reveal and keyframe preset
 * never coexist on the same clip.
 */
export const matchTextAnimationPreset = (
  keyframes: VideoClip['keyframes'] | undefined,
  baseX: number,
  baseY: number,
  baseRotation = 0,
  textReveal?: VideoClip['textReveal']
): string | null => {
  if (textReveal) {
    const revealPreset = TEXT_ANIMATION_PRESETS.find(
      (p) => p.textReveal && p.textReveal.mode === textReveal.mode
    );
    if (revealPreset && !keyframes?.length) return revealPreset.name;
  }
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
