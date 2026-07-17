import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Higgsfield (platform.higgsfield.ai). Field names are the native Higgsfield input params — they ride
// straight into the submit body (see higgsfield.adapter.ts). Media-field names `image_url`/`audio_url`
// resolve to provider-reachable URLs server-side and the adapter wraps them into Higgsfield's nested
// input objects (`input_images[]` / `input_image` / `input_audio` / `image_reference`). The `model`
// value also routes the endpoint: `soul` → text-to-image, `dop-*` → image-to-video, `speak` → Speak.

const SOUL_SIZE = [
  { value: '2048x2048', label: 'Square 2048×2048' },
  { value: '1536x2752', label: 'Portrait 9:16' },
  { value: '2752x1536', label: 'Landscape 16:9' },
  { value: '1808x2336', label: 'Portrait 3:4' },
  { value: '2336x1808', label: 'Landscape 4:3' },
];

const DOP_MODELS = [
  { value: 'dop-standard', label: 'DoP Standard' },
  { value: 'dop-turbo', label: 'DoP Turbo (fast)' },
  { value: 'dop-lite', label: 'DoP Lite' },
];

export const higgsfieldDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://higgsfield.ai",
    "tagline": "AI-native creative suite for image & video",
    "description": "An AI-native creative suite that generates images, videos, and voice from text or references — Soul for image, DoP for cinematic image-to-video, and Speak for talking-video.",
    "badges": [
      "Image",
      "Video"
    ],
    "highlights": [
      "Soul image generation from text or references",
      "DoP cinematic image-to-video",
      "Speak: lifelike talking-head videos",
      "40+ creative tools and viral effect presets",
      "Built for fast, production-grade social content"
    ]
  },
  provider: 'higgsfield',
  title: 'Higgsfield',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      model: 'soul',
      description: 'Generate a still image with Higgsfield Soul (optionally guided by a reference image).',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'select', name: 'width_and_height', label: 'Size', default: '2048x2048', options: SOUL_SIZE },
        {
          type: 'select',
          name: 'quality',
          label: 'Quality',
          default: '1080p',
          options: [
            { value: '1080p', label: '1080p' },
            { value: '720p', label: '720p' },
          ],
        },
        { type: 'number', name: 'batch_size', label: 'Images (1 or 4)', min: 1, max: 4, default: 1 },
        { type: 'media', name: 'image_url', label: 'Reference image (optional)', accept: 'image' },
        { type: 'toggle', name: 'enhance_prompt', label: 'Enhance prompt', help: 'Let Higgsfield expand your prompt', default: true },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with Higgsfield DoP.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'dop-standard', options: DOP_MODELS },
        { type: 'media', name: 'image_url', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
        { type: 'toggle', name: 'enhance_prompt', label: 'Enhance prompt', help: 'Let Higgsfield expand your prompt', default: true },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
    {
      key: 'speak',
      label: 'Speak',
      operation: 'video',
      model: 'speak',
      description: 'Make a portrait talk in sync with an audio clip (Higgsfield Speak).',
      fields: [
        { type: 'media', name: 'image_url', label: 'Portrait image', accept: 'image', required: true },
        { type: 'media', name: 'audio_url', label: 'Audio clip', accept: 'audio', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the delivery / scene…' },
        {
          type: 'select',
          name: 'quality',
          label: 'Quality',
          default: 'high',
          options: [
            { value: 'high', label: 'High' },
            { value: 'mid', label: 'Mid' },
          ],
        },
        { type: 'number', name: 'duration', label: 'Duration (5, 10, or 15s)', min: 5, max: 15, step: 5, default: 5 },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
  ],
};
