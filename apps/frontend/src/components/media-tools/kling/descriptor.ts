import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Kling video, served through the fal.ai adapter (registry/config identifier `fal`).
// Field names are the native fal request params — the adapter spreads `input` straight
// into the request body, so the descriptor IS the full feature surface.
const DURATION = [
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
];
const ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
];

export const klingDescriptor: StudioDescriptor = {
  landing: {
    "icon": "kling",
    "website": "https://klingai.com",
    "tagline": "Next-gen AI video by Kuaishou",
    "description": "A leading video generator by Kuaishou, known for long, cinematic clips with strong realism and physics. Recent models add native audio, voiceovers, and sound in a single pass.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "Cinematic clips up to ~2 minutes at up to 1080p",
      "Text-to-video and image-to-video generation",
      "Native audio: voiceovers, sound effects, ambience",
      "Multi-image reference for character consistency",
      "Multi-shot storyboarding with camera control"
    ]
  },
  provider: 'fal',
  title: 'Kling',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with Kling.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'fal-ai/kling-video/v1.6/standard/text-to-video',
          options: [
            { value: 'fal-ai/kling-video/v1.6/standard/text-to-video', label: 'Kling 1.6 Standard' },
            { value: 'fal-ai/kling-video/v1.6/pro/text-to-video', label: 'Kling 1.6 Pro' },
            { value: 'fal-ai/kling-video/v2/master/text-to-video', label: 'Kling 2.0 Master' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt' },
        { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: ASPECT },
        { type: 'number', name: 'cfg_scale', label: 'CFG scale', min: 0, max: 1, step: 0.1, default: 0.5 },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with Kling.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'fal-ai/kling-video/v1.6/standard/image-to-video',
          options: [
            { value: 'fal-ai/kling-video/v1.6/standard/image-to-video', label: 'Kling 1.6 Standard' },
            { value: 'fal-ai/kling-video/v1.6/pro/image-to-video', label: 'Kling 1.6 Pro' },
            { value: 'fal-ai/kling-video/v2/master/image-to-video', label: 'Kling 2.0 Master' },
          ],
        },
        { type: 'media', name: 'image_url', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt' },
        { type: 'select', name: 'duration', label: 'Duration', default: '5', options: DURATION },
        { type: 'number', name: 'cfg_scale', label: 'CFG scale', min: 0, max: 1, step: 0.1, default: 0.5 },
      ],
    },
  ],
};
