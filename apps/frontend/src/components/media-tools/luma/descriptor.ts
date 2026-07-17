import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Luma Dream Machine (registry/config identifier `luma`). Field names are native Luma
// params; `start_image_url`/`end_image_url` are folded into Luma's `keyframes` by the
// adapter.
const MODELS = [
  { value: 'ray-2', label: 'Ray 2' },
  { value: 'ray-flash-2', label: 'Ray Flash 2 (faster)' },
  { value: 'ray-1-6', label: 'Ray 1.6' },
];
const ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: 'Ultrawide 21:9' },
];
const RESOLUTION = [
  { value: '540p', label: '540p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];
const DURATION = [
  { value: '5s', label: '5 seconds' },
  { value: '9s', label: '9 seconds' },
];

export const lumaDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://lumalabs.ai/dream-machine",
    "tagline": "Dream Machine: ideas into video, fast",
    "description": "Luma AI's Dream Machine turns text and images into realistic, fluid video. Its Ray models are known for natural motion, strong physics, and fast, prolific creative iteration.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "Ray models for high-quality, lifelike motion",
      "Text-to-video and image-to-video generation",
      "Animate still images with natural camera moves",
      "Extend clips and build smooth transitions",
      "Strong physics and realistic, fluid movement"
    ]
  },
  provider: 'luma',
  title: 'Luma',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt with Luma Dream Machine.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'ray-2', options: MODELS },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: ASPECT },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '720p', options: RESOLUTION },
        { type: 'select', name: 'duration', label: 'Duration', default: '5s', options: DURATION },
        { type: 'toggle', name: 'loop', label: 'Loop', help: 'Seamlessly loop the clip', default: false },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate between a start (and optional end) keyframe with Luma.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', default: 'ray-2', options: MODELS },
        { type: 'media', name: 'start_image_url', label: 'Start frame', accept: 'image', required: true },
        { type: 'media', name: 'end_image_url', label: 'End frame (optional)', accept: 'image' },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: ASPECT },
        { type: 'select', name: 'resolution', label: 'Resolution', default: '720p', options: RESOLUTION },
        { type: 'select', name: 'duration', label: 'Duration', default: '5s', options: DURATION },
        { type: 'toggle', name: 'loop', label: 'Loop', help: 'Seamlessly loop the clip', default: false },
      ],
    },
  ],
};
