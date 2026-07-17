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
  | 'focal-point'
  | 'slide'
  | 'caption'
  | 'video-bg'
  | 'video-upscale';
