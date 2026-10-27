import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

// Kling AI, direct from the official API (provider identifier `kling`) — separate from the
// fal-hosted Kling models in /media/fal. Field names are the vendor's native params
// (docs: https://kling.ai/document-api); the adapter maps them onto the two API standards —
// video is path-per-model with a `settings` block (duration as int seconds, aspect_ratio is
// t2v-only, audio only on kling-3.0/2.6), image is the legacy /v1 body with model_name.
const VIDEO_MODELS = [
  { value: 'kling-3.0-turbo', label: 'Kling 3.0 Turbo' },
  { value: 'kling-3.0', label: 'Kling 3.0' },
  { value: 'kling-2.6', label: 'Kling 2.6' },
  { value: 'kling-2.5-turbo', label: 'Kling 2.5 Turbo' },
];
const IMAGE_MODELS = [
  { value: 'kling-v3', label: 'Kling V3' },
  { value: 'kling-v2-1', label: 'Kling V2.1' },
];
const DURATION = [
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
];
const VIDEO_ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
];
const IMAGE_ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
  { value: '4:3', label: 'Classic 4:3' },
  { value: '3:4', label: 'Portrait 3:4' },
  { value: '3:2', label: 'Photo 3:2' },
  { value: '2:3', label: 'Portrait 2:3' },
  { value: '21:9', label: 'Ultrawide 21:9' },
];
const RESOLUTION = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];
const AUDIO = [
  { value: 'off', label: 'Silent' },
  { value: 'native', label: 'Native audio' },
];
const RESOLUTION_FIELD = {
  type: 'select' as const,
  name: 'resolution',
  label: 'Resolution',
  default: '720p',
  options: RESOLUTION,
  optionRules: [
    {
      when: { model: 'kling-2.6', audio: 'native' },
      options: [{ value: '1080p', label: '1080p (required for native audio)' }],
    },
  ],
  help: 'Kling 2.6 requires 1080p when native audio is enabled.',
};

export const klingAiDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://kling.ai',
    tagline: 'Next-gen AI video by Kuaishou — direct API',
    description:
      'The official Kling AI API: cinematic text-to-video and image-to-video with native audio on current models, plus high-quality text-to-image — billed straight to your own Kling AI resource pack.',
    badges: ['Video', 'Image'],
    highlights: [
      'Direct integration — your klingai.com API key, no aggregator markup',
      'Kling 3.0 / 2.6 video with optional native audio, up to 1080p',
      'Text-to-video and image-to-video with first/last-frame control',
      'Kling V3 text-to-image up to 2K in eight aspect ratios',
    ],
  },
  provider: 'kling',
  title: 'Kling AI',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with the official Kling AI API.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', default: 'kling-3.0-turbo', options: VIDEO_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: VIDEO_ASPECT },
        RESOLUTION_FIELD,
        { type: 'select', name: 'audio', label: 'Audio', options: AUDIO, help: 'Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio.' },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with the official Kling AI API.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', default: 'kling-3.0-turbo', options: VIDEO_MODELS },
        { type: 'media', name: 'image', label: 'First frame', accept: 'image', required: true },
        { type: 'media', name: 'image_tail', label: 'Last frame (optional)', accept: 'image' },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
        { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
        RESOLUTION_FIELD,
        { type: 'select', name: 'audio', label: 'Audio', options: AUDIO, help: 'Kling 3.0 / 2.6 only; 3.0 Turbo always renders native audio.' },
      ],
    },
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with Kling V3 / V2.1 on the official Kling AI API.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', default: 'kling-v3', options: IMAGE_MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: IMAGE_ASPECT },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '1k', options: [
          { value: '1k', label: '1K standard' },
          { value: '2k', label: '2K high-res' },
        ] },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 9, step: 1, default: 1 },
      ],
    },
  ],
};
