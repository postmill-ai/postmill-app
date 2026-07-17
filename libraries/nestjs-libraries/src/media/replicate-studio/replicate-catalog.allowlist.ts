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
    'black-forest-labs/flux-schnell',
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
    'google/veo-3',
    'minimax/video-01',
    'bytedance/seedance-1-pro',
    'kwaivgi/kling-v2.1',
  ],
  'image-to-video': [
    'minimax/video-01',
    'bytedance/seedance-1-pro',
    'kwaivgi/kling-v2.1',
  ],
  'video-to-video': [
    'bytedance/seedance-1-pro',
  ],
  'video-upscale': [
    'topazlabs/video-upscale',
    'lucataco/real-esrgan-video',
  ],
  'video-background': [
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
  'black-forest-labs/flux-schnell',
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
  'google/veo-3',
  'minimax/video-01',
  'bytedance/seedance-1-pro',
  'kwaivgi/kling-v2.1',
  'topazlabs/video-upscale',
  // Audio
  'minimax/speech-02-hd',
  'minimax/voice-cloning',
]);

export function isWarm(modelId: string): boolean {
  return OFFICIAL_MODELS.has(modelId);
}
