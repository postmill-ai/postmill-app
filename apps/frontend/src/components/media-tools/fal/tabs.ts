import type { StudioTab } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

const DURATION = [
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
];
const KLING_ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
];
const PIKA_ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
  { value: '4:5', label: 'Portrait 4:5' },
  { value: '5:4', label: 'Landscape 5:4' },
  { value: '3:2', label: 'Landscape 3:2' },
  { value: '2:3', label: 'Portrait 2:3' },
];
const RESOLUTION = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];
export const FLUX_IMAGE_TAB: StudioTab = {
  key: 'text-to-image',
  label: 'Text → Image',
  operation: 'image',
  model: 'fal-ai/flux/schnell',
  description: 'Generate images with FLUX.1 Schnell through your fal.ai connection.',
  fields: [
    { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
    { type: 'select', name: 'image_size', label: 'Image size', default: 'landscape_4_3', options: [
      { value: 'square_hd', label: 'Square HD' },
      { value: 'square', label: 'Square' },
      { value: 'portrait_4_3', label: 'Portrait 4:3' },
      { value: 'portrait_16_9', label: 'Portrait 16:9' },
      { value: 'landscape_4_3', label: 'Landscape 4:3' },
      { value: 'landscape_16_9', label: 'Landscape 16:9' },
    ] },
    { type: 'number', name: 'num_inference_steps', label: 'Inference steps', min: 1, max: 12, step: 1, default: 4 },
    { type: 'select', name: 'output_format', label: 'Output format', default: 'jpeg', options: [
      { value: 'jpeg', label: 'JPEG' },
      { value: 'png', label: 'PNG' },
    ] },
    { type: 'number', name: 'seed', label: 'Seed (optional)' },
    { type: 'toggle', name: 'enable_safety_checker', label: 'Safety checker', default: true },
  ],
};

export const FAL_KLING_TABS: StudioTab[] = [
  {
    key: 'text-to-video',
    label: 'Kling Text → Video',
    operation: 'video',
    description: 'Generate a video clip from a text prompt with Kling on fal.ai.',
    fields: [
      {
        type: 'select',
        name: 'model',
        label: 'Model',
        default: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
        options: [
          { value: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', label: 'Kling 2.5 Turbo Pro' },
          { value: 'fal-ai/kling-video/v2.6/pro/text-to-video', label: 'Kling 2.6 Pro' },
        ],
      },
      { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
      { type: 'text', name: 'negative_prompt', label: 'Negative prompt' },
      { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
      { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: KLING_ASPECT },
      {
        type: 'number', name: 'cfg_scale', label: 'CFG scale', min: 0, max: 1, step: 0.1, default: 0.5,
        visibleWhen: { model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video' },
      },
      {
        type: 'toggle', name: 'generate_audio', label: 'Generate audio', default: false,
        visibleWhen: { model: 'fal-ai/kling-video/v2.6/pro/text-to-video' },
      },
    ],
  },
  {
    key: 'image-to-video',
    label: 'Kling Image → Video',
    operation: 'video',
    description: 'Animate a source image into a video clip with Kling on fal.ai.',
    fields: [
      {
        type: 'select',
        name: 'model',
        label: 'Model',
        default: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        options: [
          { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling 2.5 Turbo Pro' },
          { value: 'fal-ai/kling-video/v2.6/pro/image-to-video', label: 'Kling 2.6 Pro' },
        ],
      },
      { type: 'media', name: 'image_url', label: 'Source image', accept: 'image', required: true },
      { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
      { type: 'text', name: 'negative_prompt', label: 'Negative prompt' },
      { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
      {
        type: 'number', name: 'cfg_scale', label: 'CFG scale', min: 0, max: 1, step: 0.1, default: 0.5,
        visibleWhen: { model: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video' },
      },
      {
        type: 'toggle', name: 'generate_audio', label: 'Generate audio', default: false,
        visibleWhen: { model: 'fal-ai/kling-video/v2.6/pro/image-to-video' },
      },
    ],
  },
];

export const FAL_PIKA_TABS: StudioTab[] = [
  {
    key: 'text-to-video',
    label: 'Text → Video',
    operation: 'video',
    model: 'fal-ai/pika/v2.2/text-to-video',
    description: 'Generate a video clip from a text prompt with Pika 2.2.',
    fields: [
      { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
      { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'ugly, bad, terrible' },
      { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: PIKA_ASPECT },
      { type: 'select', name: 'resolution', label: 'Resolution', default: '720p', options: RESOLUTION },
      { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
      { type: 'number', name: 'seed', label: 'Seed (optional)' },
    ],
  },
  {
    key: 'image-to-video',
    label: 'Image → Video',
    operation: 'video',
    model: 'fal-ai/pika/v2.2/image-to-video',
    description: 'Turn a source image into a dynamic video clip with Pika 2.2.',
    fields: [
      { type: 'media', name: 'image_url', label: 'Source image', accept: 'image', required: true },
      { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
      { type: 'text', name: 'negative_prompt', label: 'Negative prompt' },
      { type: 'select', name: 'resolution', label: 'Resolution', default: '720p', options: RESOLUTION },
      { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
      { type: 'number', name: 'seed', label: 'Seed (optional)' },
    ],
  },
];

export const STABLE_AUDIO_TAB: StudioTab = {
  key: 'text-to-music',
  label: 'Text → Music',
  operation: 'audio',
  model: 'fal-ai/stable-audio',
  description: 'Generate music and audio from a text prompt with Stable Audio on fal.ai.',
  fields: [
    { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the music or sound…' },
    { type: 'number', name: 'seconds_total', label: 'Duration (seconds)', min: 1, max: 47, step: 1, default: 30 },
    { type: 'number', name: 'cfg_scale', label: 'CFG scale', min: 1, max: 20, step: 0.5, default: 7 },
    { type: 'number', name: 'seed', label: 'Seed (optional)' },
  ],
};
