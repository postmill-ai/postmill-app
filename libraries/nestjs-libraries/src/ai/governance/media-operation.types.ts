/**
 * Shared media-operation union.
 *
 * Lives in its own file so `ai/defaults/default-categories.ts` and
 * `ai/governance/media.service.ts` can share the type without a circular import.
 */
export type MediaOperation =
  | 'image'
  | 'video'
  | 'audio'
  | 'avatar'
  | 'tts'
  | 'stt'
  | 'upscale'
  | 'bg-remove'
  | 'inpaint'
  | 'outpaint'
  | 'focal-point'
  | 'slide'
  | 'caption'
  | 'video-bg'
  | 'video-upscale';

// The generative subset a Designer genAI modal can offer a provider/model picker
// for — the only values `GET /media/generation-providers?operation=` accepts.
export const GENERATION_OPERATIONS = ['image', 'video', 'audio', 'avatar', 'tts'] as const;
export type GenerationOperation = (typeof GENERATION_OPERATIONS)[number];
