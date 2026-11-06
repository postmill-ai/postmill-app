import type { VideoClip } from './designer.store';
import type { EaseType } from './video-preview';

export type AnimationPresetCategory = 'entrance' | 'emphasis' | 'exit';

export interface TextAnimationPreset {
  /** Stable identifier/value — persisted on the clip and used for matching. Never translate. */
  name: string;
  /** i18n key for the display label — the `name` above stays the canonical stored value. */
  nameKey: string;
  category: AnimationPresetCategory;
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
export const ANIMATION_TRACK_TYPES = new Set(['text', 'caption', 'shape', 'image', 'sticker', 'raster', 'video']);

/** Typewriter pacing: each character appears every ~80ms of the reveal window. */
export const TYPEWRITER_MS_PER_CHAR = 80;

/**
 * Keyframe props the apply handler treats as RELATIVE to the clip's base
 * transform (preset value + clip's current x/y/rotation). Everything else
 * (opacity, …) is absolute.
 */
export const TEXT_ANIM_RELATIVE_PROPS = new Set(['x', 'y', 'rotation']);
export const TEXT_ANIM_SCALE_PROPS = new Set(['width', 'height']);

export const TEXT_ANIMATION_PRESETS: TextAnimationPreset[] = [
  {
    name: 'Typewriter',
    nameKey: 'designer_text_anim_typewriter',
    // A text reveal, not an opacity fade: the string is drawn as a growing
    // prefix (see designer-doc/text-reveal) at ~80ms per character — the old
    // 300ms opacity ramp was indistinguishable from Pop.
    category: 'entrance',
    keyframes: [],
    textReveal: { mode: 'chars' },
  },
  {
    name: 'Pop',
    nameKey: 'designer_text_anim_pop',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 400, props: { opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Fade Up',
    nameKey: 'designer_text_anim_fade_up',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { y: 20, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { y: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Fade Down',
    nameKey: 'designer_text_anim_fade_down',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { y: -20, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { y: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Slide In Left',
    nameKey: 'designer_text_anim_slide_in_left',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { x: -60, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { x: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Slide In Right',
    nameKey: 'designer_text_anim_slide_in_right',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { x: 60, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { x: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Rotate In',
    nameKey: 'designer_text_anim_rotate_in',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { rotation: -12, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { rotation: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Bounce Up',
    nameKey: 'designer_text_anim_bounce_up',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { y: 30, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 350, props: { y: -6, opacity: 1 }, ease: 'easeOut' as EaseType },
      { tMs: 550, props: { y: 0, opacity: 1 }, ease: 'easeInOut' as EaseType },
    ],
  },
  {
    name: 'Zoom In',
    nameKey: 'designer_anim_zoom_in',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { width: 0.5, height: 0.5, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { width: 1, height: 1, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Zoom Out',
    nameKey: 'designer_anim_zoom_out',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { width: 1.5, height: 1.5, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { width: 1, height: 1, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Spin In',
    nameKey: 'designer_anim_spin_in',
    category: 'entrance',
    keyframes: [
      { tMs: 0, props: { rotation: -180, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 650, props: { rotation: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
  {
    name: 'Pulse',
    nameKey: 'designer_anim_pulse',
    category: 'emphasis',
    keyframes: [
      { tMs: 0, props: { width: 1, height: 1 }, ease: 'easeInOut' as EaseType },
      { tMs: 300, props: { width: 1.08, height: 1.08 }, ease: 'easeInOut' as EaseType },
      { tMs: 600, props: { width: 1, height: 1 }, ease: 'easeInOut' as EaseType },
    ],
  },
  {
    name: 'Shake',
    nameKey: 'designer_anim_shake',
    category: 'emphasis',
    keyframes: [
      { tMs: 0, props: { x: 0 }, ease: 'easeInOut' as EaseType },
      { tMs: 100, props: { x: -10 }, ease: 'easeInOut' as EaseType },
      { tMs: 200, props: { x: 10 }, ease: 'easeInOut' as EaseType },
      { tMs: 300, props: { x: -6 }, ease: 'easeInOut' as EaseType },
      { tMs: 400, props: { x: 0 }, ease: 'easeInOut' as EaseType },
    ],
  },
  {
    name: 'Swing',
    nameKey: 'designer_anim_swing',
    category: 'emphasis',
    keyframes: [
      { tMs: 0, props: { rotation: -8 }, ease: 'easeInOut' as EaseType },
      { tMs: 250, props: { rotation: 6 }, ease: 'easeInOut' as EaseType },
      { tMs: 500, props: { rotation: -3 }, ease: 'easeInOut' as EaseType },
      { tMs: 750, props: { rotation: 0 }, ease: 'easeInOut' as EaseType },
    ],
  },
  {
    name: 'Fade Out',
    nameKey: 'designer_anim_fade_out',
    category: 'exit',
    keyframes: [
      { tMs: -500, props: { opacity: 1 }, ease: 'easeIn' as EaseType },
      { tMs: 0, props: { opacity: 0 }, ease: 'easeIn' as EaseType },
    ],
  },
  {
    name: 'Slide Out Left',
    nameKey: 'designer_anim_slide_out_left',
    category: 'exit',
    keyframes: [
      { tMs: -500, props: { x: 0, opacity: 1 }, ease: 'easeIn' as EaseType },
      { tMs: 0, props: { x: -60, opacity: 0 }, ease: 'easeIn' as EaseType },
    ],
  },
  {
    name: 'Slide Out Right',
    nameKey: 'designer_anim_slide_out_right',
    category: 'exit',
    keyframes: [
      { tMs: -500, props: { x: 0, opacity: 1 }, ease: 'easeIn' as EaseType },
      { tMs: 0, props: { x: 60, opacity: 0 }, ease: 'easeIn' as EaseType },
    ],
  },
  {
    name: 'Zoom Out Exit',
    nameKey: 'designer_anim_zoom_out_exit',
    category: 'exit',
    keyframes: [
      { tMs: -500, props: { width: 1, height: 1, opacity: 1 }, ease: 'easeIn' as EaseType },
      { tMs: 0, props: { width: 0.5, height: 0.5, opacity: 0 }, ease: 'easeIn' as EaseType },
    ],
  },
  {
    name: 'Spin Out',
    nameKey: 'designer_anim_spin_out',
    category: 'exit',
    keyframes: [
      { tMs: -650, props: { rotation: 0, opacity: 1 }, ease: 'easeIn' as EaseType },
      { tMs: 0, props: { rotation: 180, opacity: 0 }, ease: 'easeIn' as EaseType },
    ],
  },
  {
    name: 'Bounce Out',
    nameKey: 'designer_anim_bounce_out',
    category: 'exit',
    keyframes: [
      { tMs: -550, props: { y: 0, opacity: 1 }, ease: 'easeInOut' as EaseType },
      { tMs: -250, props: { y: -8, opacity: 1 }, ease: 'easeInOut' as EaseType },
      { tMs: 0, props: { y: 30, opacity: 0 }, ease: 'easeIn' as EaseType },
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
  clip: Pick<VideoClip, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'text' | 'startMs' | 'endMs' | 'fontSize'>,
  scaleText = false
): Pick<VideoClip, 'keyframes' | 'textReveal'> => {
  const base: Record<string, number> = {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    width: clip.width ?? 1,
    height: clip.height ?? 1,
    rotation: clip.rotation ?? 0,
    fontSize: clip.fontSize ?? 16,
  };
  const clipDuration = clip.endMs - clip.startMs;
  const keyframes = (preset.keyframes ?? [])
    .map((kf) => ({
      ...kf,
      tMs: preset.category === 'exit' ? Math.max(0, clipDuration + kf.tMs) : kf.tMs,
      props: (() => {
        const props: Record<string, number> = {};
        for (const [key, value] of Object.entries(kf.props)) {
          props[key] = TEXT_ANIM_RELATIVE_PROPS.has(key)
            ? (base[key] ?? 0) + value
            : TEXT_ANIM_SCALE_PROPS.has(key)
              ? (base[key] ?? 1) * value
              : value;
          if (key === 'width') {
            props.x = base.x + base.width * (1 - value) / 2;
            if (scaleText) props.fontSize = base.fontSize * value;
          } else if (key === 'height') {
            props.y = base.y + base.height * (1 - value) / 2;
          }
        }
        return props;
      })(),
    }))
    .filter((kf) => Object.keys(kf.props).length > 0);

  let textReveal: VideoClip['textReveal'];
  if (preset.textReveal) {
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
  textReveal?: VideoClip['textReveal'],
  baseWidth = 1,
  baseHeight = 1,
  durationMs = 0,
  baseFontSize = 16,
  scaleText = false
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
      const expectedTime = preset.category === 'exit' ? Math.max(0, durationMs + pk[i].tMs) : pk[i].tMs;
      if (expectedTime !== keyframes[i].tMs) continue outer;
      const expected: Record<string, number> = {};
      for (const [k, v] of Object.entries(pk[i].props)) {
        expected[k] =
          k === 'x'
            ? baseX + v
            : k === 'y'
              ? baseY + v
              : k === 'rotation'
                ? baseRotation + v
                : k === 'width'
                  ? baseWidth * v
                  : k === 'height'
                    ? baseHeight * v
                    : v;
        if (k === 'width') {
          expected.x = baseX + baseWidth * (1 - v) / 2;
          if (scaleText) expected.fontSize = baseFontSize * v;
        } else if (k === 'height') {
          expected.y = baseY + baseHeight * (1 - v) / 2;
        }
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
