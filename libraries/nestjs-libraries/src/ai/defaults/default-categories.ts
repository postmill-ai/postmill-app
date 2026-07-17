import type { MediaOperation } from '@gitroom/nestjs-libraries/ai/governance/media-operation.types';

/** AI text/vision categories that replace the legacy scope system. */
export const AI_MODEL_CATEGORIES = [
  'low-reasoning',
  'high-reasoning',
  'vision',
  'workflow',
] as const;

export type AiModelCategory = (typeof AI_MODEL_CATEGORIES)[number];

/** AI media categories surfaced under Settings → Content → Media Defaults. */
export const AI_MEDIA_CATEGORIES = [
  'text-to-speech',
  'text-to-music',
  'text-to-image',
  'text-to-video',
  'image-to-image',
  'image-to-video',
  'image-upscale',
  'image-bg-remove',
  'image-inpaint',
  'image-focal-point',
  'image-slide',
  'video-avatar',
  'video-caption',
  'video-to-video',
  'video-background',
  'video-upscale',
] as const;

export type AiMediaCategory = (typeof AI_MEDIA_CATEGORIES)[number];

/** Legacy AI scope names that are being re-pointed onto model categories. */
export type AiScope = 'utility' | 'generator' | 'agent' | 'mcp';

/** Confirmed re-point mapping: legacy scope → new model category. */
export const SCOPE_TO_CATEGORY: Record<AiScope, AiModelCategory> = {
  utility: 'low-reasoning',
  generator: 'high-reasoning',
  agent: 'high-reasoning',
  mcp: 'high-reasoning',
};

/**
 * Each media category resolves to a base operation. The input shape (text/image/video/mask)
 * is carried separately so that, for example, `text-to-image` and `image-to-image` can both
 * use operation `'image'` while passing different `input` shapes.
 */
export const MEDIA_CATEGORY_OPERATION: Record<AiMediaCategory, MediaOperation> = {
  'text-to-speech': 'tts',
  'text-to-music': 'audio',
  'text-to-image': 'image',
  'text-to-video': 'video',
  'image-to-image': 'image',
  'image-to-video': 'video',
  'image-upscale': 'upscale',
  'image-bg-remove': 'bg-remove',
  'image-inpaint': 'inpaint',
  'image-focal-point': 'focal-point',
  'image-slide': 'slide',
  'video-avatar': 'avatar',
  'video-caption': 'caption',
  'video-to-video': 'video',
  'video-background': 'video-bg',
  'video-upscale': 'video-upscale',
};

/** Minimum input shape for each media category. */
export const MEDIA_CATEGORY_INPUT: Record<
  AiMediaCategory,
  'text' | 'image' | 'image+mask' | 'video' | 'text+image' | 'text+video' | 'text+image+mask'
> = {
  'text-to-speech': 'text',
  'text-to-music': 'text',
  'text-to-image': 'text',
  'text-to-video': 'text',
  'image-to-image': 'text+image',
  'image-to-video': 'text+image',
  'image-upscale': 'image',
  'image-bg-remove': 'image',
  'image-inpaint': 'text+image+mask',
  'image-focal-point': 'image',
  'image-slide': 'text',
  'video-avatar': 'text',
  'video-caption': 'video',
  'video-to-video': 'text+video',
  'video-background': 'video',
  'video-upscale': 'video',
};
