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
   * applying it replaces the current entrance and writes `clip.textReveal`.
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

type AnimationClip = Pick<
  VideoClip,
  'x' | 'y' | 'width' | 'height' | 'rotation' | 'text' | 'startMs' | 'endMs' |
  'fontSize' | 'keyframes' | 'textReveal'
>;
type AnimationKeyframe = NonNullable<VideoClip['keyframes']>[number];

const buildPresetKeyframes = (
  preset: TextAnimationPreset,
  clip: AnimationClip,
  scaleText: boolean,
  durationMs: number
): AnimationKeyframe[] => {
  const base: Record<string, number> = {
    x: clip.x ?? 0,
    y: clip.y ?? 0,
    width: clip.width ?? 1,
    height: clip.height ?? 1,
    rotation: clip.rotation ?? 0,
    fontSize: clip.fontSize ?? 16,
  };
  return (preset.keyframes ?? [])
    .map((kf) => ({
      ...kf,
      tMs: preset.category === 'exit' ? Math.max(0, durationMs + kf.tMs) : kf.tMs,
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
};

const matchingNumber = (actual: number | undefined, expected: number) =>
  typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= 0.01;

const removePresetKeyframes = (
  keyframes: VideoClip['keyframes'],
  preset: TextAnimationPreset,
  clip: AnimationClip,
  scaleText: boolean,
  durationMs: number
): AnimationKeyframe[] => {
  const owned = buildPresetKeyframes(preset, clip, scaleText, durationMs);
  return (keyframes ?? []).flatMap((frame) => {
    const expected = owned.filter((candidate) => candidate.tMs === frame.tMs);
    if (!expected.length) return [frame];
    const props = { ...frame.props };
    for (const ownedFrame of expected) {
      for (const [key, value] of Object.entries(ownedFrame.props)) {
        if (matchingNumber(props[key], value)) delete props[key];
      }
    }
    return Object.keys(props).length ? [{ ...frame, props }] : [];
  });
};

/**
 * Compose a preset with the clip's existing animation channels. Only the
 * previously matched preset in the same category is replaced; other categories
 * and manual keyframes remain intact. `previousDurationMs` lets a timing edit
 * remove an exit at its old position before writing it at the new clip end.
 */
export const buildTextAnimationUpdate = (
  preset: TextAnimationPreset,
  clip: AnimationClip,
  scaleText = false,
  previousDurationMs?: number
): Pick<VideoClip, 'keyframes' | 'textReveal'> => {
  const clipDuration = clip.endMs - clip.startMs;
  const oldDuration = previousDurationMs ?? clipDuration;
  const previousName = matchTextAnimationPreset(
    clip.keyframes,
    clip.x ?? 0,
    clip.y ?? 0,
    clip.rotation ?? 0,
    clip.textReveal,
    clip.width ?? 1,
    clip.height ?? 1,
    oldDuration,
    clip.fontSize ?? 16,
    scaleText,
    preset.category
  );
  const previous = TEXT_ANIMATION_PRESETS.find(
    (candidate) => candidate.name === previousName && candidate.category === preset.category
  );
  const remaining = previous && !previous.textReveal
    ? removePresetKeyframes(clip.keyframes, previous, clip, scaleText, oldDuration)
    : [...(clip.keyframes ?? [])];
  const generated = buildPresetKeyframes(preset, clip, scaleText, clipDuration);
  const byTime = new Map<number, AnimationKeyframe>();
  for (const frame of [...remaining, ...generated]) {
    const existing = byTime.get(frame.tMs);
    const incoming = { ...frame.props };
    if (existing) {
      if (frame.props.width !== undefined && existing.props.x !== undefined) delete incoming.x;
      if (frame.props.height !== undefined && existing.props.y !== undefined) delete incoming.y;
    }
    byTime.set(frame.tMs, existing
      ? { ...frame, props: { ...existing.props, ...incoming } }
      : { ...frame, props: incoming });
  }

  let textReveal = clip.textReveal;
  if (preset.category === 'entrance') {
    textReveal = undefined;
    if (preset.textReveal) {
      const chars = (clip.text || '').length;
      const paced = Math.max(1, Math.round(chars * TYPEWRITER_MS_PER_CHAR));
      textReveal = {
        mode: preset.textReveal.mode,
        ...(chars ? { durationMs: Math.min(clipDuration, paced) } : {}),
      };
    }
  }
  return {
    keyframes: [...byTime.values()].sort((a, b) => a.tMs - b.tMs),
    textReveal,
  };
};

/**
 * Match a preset's contributions within a possibly combined keyframe timeline.
 * Additional frames and properties are allowed, so each category can remain
 * active independently. Typewriter matches its reveal alongside keyframes.
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
  scaleText = false,
  category?: AnimationPresetCategory
): string | null => {
  if (textReveal && (!category || category === 'entrance')) {
    const revealPreset = TEXT_ANIMATION_PRESETS.find(
      (p) => p.textReveal && p.textReveal.mode === textReveal.mode
    );
    if (revealPreset) return revealPreset.name;
  }
  if (!keyframes?.length) return null;
  let best: { name: string; specificity: number } | null = null;
  for (const preset of TEXT_ANIMATION_PRESETS) {
    if ((category && preset.category !== category) || preset.textReveal) continue;
    const expectedFrames = buildPresetKeyframes(preset, {
      x: baseX,
      y: baseY,
      width: baseWidth,
      height: baseHeight,
      rotation: baseRotation,
      fontSize: baseFontSize,
      startMs: 0,
      endMs: durationMs,
    }, scaleText, durationMs);
    if (!expectedFrames.length) continue;
    const matches = expectedFrames.every((expected) =>
      keyframes.some((actual) => {
        if (actual.tMs !== expected.tMs) return false;
        const scaled = expected.props.width !== undefined || expected.props.height !== undefined;
        return Object.entries(expected.props).every(([key, value]) =>
          (scaled && (key === 'x' || key === 'y')) || matchingNumber(actual.props[key], value)
        );
      })
    );
    const specificity = expectedFrames.reduce(
      (count, frame) => count + Object.keys(frame.props).length,
      0
    );
    if (matches && specificity > (best?.specificity ?? -1)) {
      best = { name: preset.name, specificity };
    }
  }
  return best?.name ?? null;
};

export const matchTextAnimationPresets = (
  clip: AnimationClip,
  scaleText = false
): Partial<Record<AnimationPresetCategory, string>> => {
  const matches: Partial<Record<AnimationPresetCategory, string>> = {};
  for (const category of ['entrance', 'emphasis', 'exit'] as const) {
    const name = matchTextAnimationPreset(
      clip.keyframes,
      clip.x ?? 0,
      clip.y ?? 0,
      clip.rotation ?? 0,
      clip.textReveal,
      clip.width ?? 1,
      clip.height ?? 1,
      clip.endMs - clip.startMs,
      clip.fontSize ?? 16,
      scaleText,
      category
    );
    if (name) matches[category] = name;
  }
  return matches;
};
