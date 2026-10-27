// Replicate Media Studio — Catalog Allowlist
// Single source of truth for model curation. Edit this file to add/remove models.

export interface CategoryDefinition {
  key: string;
  medium: 'image' | 'video' | 'audio';
  label: string;
  collectionSlug?: string;
  execution: 'sync' | 'async' | 'local';
}

export const CATEGORIES: CategoryDefinition[] = [
  // IMAGE
  { key: 'text-to-image', medium: 'image', label: 'Text to Image', collectionSlug: 'text-to-image', execution: 'sync' },
  { key: 'image-to-image', medium: 'image', label: 'Image to Image', collectionSlug: 'image-editing', execution: 'sync' },
  { key: 'background-remove', medium: 'image', label: 'Remove Background', collectionSlug: 'remove-backgrounds', execution: 'sync' },
  { key: 'upscale', medium: 'image', label: 'Upscale', collectionSlug: 'super-resolution', execution: 'sync' },
  { key: 'restore', medium: 'image', label: 'Restore', collectionSlug: 'ai-image-restoration', execution: 'async' },
  { key: 'inpaint', medium: 'image', label: 'Inpaint', execution: 'sync' },
  { key: 'meme', medium: 'image', label: 'Meme Generator', execution: 'local' },
  // VIDEO
  { key: 'text-to-video', medium: 'video', label: 'Text to Video', collectionSlug: 'text-to-video', execution: 'async' },
  { key: 'image-to-video', medium: 'video', label: 'Image to Video', collectionSlug: 'image-to-video', execution: 'async' },
  { key: 'video-to-video', medium: 'video', label: 'Video to Video', execution: 'async' },
  { key: 'video-upscale', medium: 'video', label: 'Video Upscale', collectionSlug: 'ai-enhance-videos', execution: 'async' },
  { key: 'video-background', medium: 'video', label: 'Video Background', execution: 'async' },
  { key: 'caption', medium: 'video', label: 'Caption Video', execution: 'async' },
  { key: 'merge', medium: 'video', label: 'Merge Videos', execution: 'local' },
  // AUDIO
  { key: 'tts', medium: 'audio', label: 'Text to Speech', collectionSlug: 'text-to-speech', execution: 'async' },
  { key: 'text-to-music', medium: 'audio', label: 'Text to Music', collectionSlug: 'ai-music-generation', execution: 'async' },
  { key: 'music-to-music', medium: 'audio', label: 'Music to Music', execution: 'async' },
  { key: 'voice-clone', medium: 'audio', label: 'Voice Clone', collectionSlug: 'sing-with-voices', execution: 'async' },
  { key: 'stt', medium: 'audio', label: 'Speech to Text', collectionSlug: 'speech-to-text', execution: 'sync' },
];

// MODEL_ALLOWLIST: category key → array of "owner/name" model IDs
// Tag each with O (official) or C (community). OFFICIAL_MODELS = the O's.
export const MODEL_ALLOWLIST: Record<string, string[]> = {
  'text-to-image': [
    'black-forest-labs/flux-dev',
    'black-forest-labs/flux-1.1-pro',
    'google/imagen-4',
    'ideogram-ai/ideogram-v3-turbo',
    'stability-ai/stable-diffusion-3.5-large',
  ],
  'image-to-image': [
    'black-forest-labs/flux-kontext-pro',
    'black-forest-labs/flux-dev',
  ],
  'background-remove': [
    'bria/remove-background',
    '851-labs/background-remover',
  ],
  'upscale': [
    'recraft-ai/recraft-crisp-upscale',
    'nightmareai/real-esrgan',
    'philz1337x/clarity-upscaler',
  ],
  'restore': [
    'tencentarc/gfpgan',
    'sczhou/codeformer',
  ],
  'inpaint': [
    'black-forest-labs/flux-fill-pro',
    'stability-ai/stable-diffusion-inpainting',
  ],
  'text-to-video': [
    // google/veo-3 was retired upstream (prod jobs 404'd from
    // aiplatform.googleapis.com); veo-3.1 is the live official replacement
    // (verified against the live Replicate schema: same inputs + generate_audio).
    'google/veo-3.1',
    'minimax/video-01',
    'bytedance/seedance-1-pro',
    // kling-v2.1 was misfiled here: it is strictly image-to-video upstream
    // (mandatory `start_image`). kling-v2.5-turbo-pro is the t2v-capable Kling
    // (verified against the live Replicate schema: only `prompt` is required).
    'kwaivgi/kling-v2.5-turbo-pro',
  ],
  'image-to-video': [
    'minimax/video-01',
    'bytedance/seedance-1-pro',
    // kling-v2.1 and kling-v2.1-master were discontinued upstream (error 1203).
    // Kling 2.5 Turbo Pro supports both t2v and i2v through `start_image`.
    'kwaivgi/kling-v2.5-turbo-pro',
  ],
  'video-to-video': [
    // seedance-1-pro has no video input (t2v/i2v only) — the picker asked for an
    // IMAGE and generation 422'd. wan-2.7-videoedit takes a required `video` uri
    // input plus `prompt` (verified against the live Replicate schema).
    'wan-video/wan-2.7-videoedit',
  ],
  'video-upscale': [
    'topazlabs/video-upscale',
    'lucataco/real-esrgan-video',
  ],
  'video-background': [
    // rembg-video FIRST — it is the default when the org hasn't pinned a
    // model: rembg's general salient-object segmentation handles products,
    // pets, and other non-human subjects (verified against the live schema:
    // required `video` uri, optional `mode` + `background_color`).
    // robust_video_matting is human-only matting — objects/products get matted
    // out with the background (QA prod failure 2026-10-22).
    'lucataco/rembg-video',
    'arielreplicate/robust_video_matting',
  ],
  'caption': [
    'fictions-ai/autocaption',
  ],
  'tts': [
    'minimax/speech-02-hd',
    'jaaari/kokoro-82m',
    'resemble-ai/chatterbox',
  ],
  'text-to-music': [
    'meta/musicgen',
    'riffusion/riffusion',
  ],
  'music-to-music': [
    'meta/musicgen',
  ],
  'voice-clone': [
    'minimax/voice-cloning',
    'resemble-ai/chatterbox',
  ],
  'stt': [
    'openai/whisper',
    'victor-upmeet/whisperx',
    'vaibhavs10/incredibly-fast-whisper',
  ],
};

// OFFICIAL_MODELS: subset of MODEL_ALLOWLIST that is genuinely Replicate-official (always-warm, output-priced)
export const OFFICIAL_MODELS = new Set<string>([
  // Image
  'black-forest-labs/flux-dev',
  'black-forest-labs/flux-1.1-pro',
  'google/imagen-4',
  'ideogram-ai/ideogram-v3-turbo',
  'stability-ai/stable-diffusion-3.5-large',
  'black-forest-labs/flux-kontext-pro',
  'bria/remove-background',
  'recraft-ai/recraft-crisp-upscale',
  'black-forest-labs/flux-fill-pro',
  // Video
  'google/veo-3.1',
  'minimax/video-01',
  'bytedance/seedance-1-pro',
  'kwaivgi/kling-v2.5-turbo-pro',
  'wan-video/wan-2.7-videoedit',
  'topazlabs/video-upscale',
  // Audio
  'minimax/speech-02-hd',
  'minimax/voice-cloning',
]);

export function isWarm(modelId: string): boolean {
  return OFFICIAL_MODELS.has(modelId);
}
