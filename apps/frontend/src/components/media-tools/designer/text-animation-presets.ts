import type { VideoClip } from './designer.store';
import type { EaseType } from './video-preview';

export interface TextAnimationPreset {
  /** Stable identifier/value — persisted on the clip and used for matching. Never translate. */
  name: string;
  /** i18n key for the display label — the `name` above stays the canonical stored value. */
  nameKey: string;
  keyframes: VideoClip['keyframes'];
}

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
    name: 'Slide In Left',
    nameKey: 'designer_text_anim_slide_in_left',
    keyframes: [
      { tMs: 0, props: { x: -60, opacity: 0 }, ease: 'easeOut' as EaseType },
      { tMs: 500, props: { x: 0, opacity: 1 }, ease: 'easeOut' as EaseType },
    ],
  },
];
