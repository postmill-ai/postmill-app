import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Pika video, served through the fal.ai adapter (registry/config identifier `fal`) — Pika's
// official API is hosted on fal (pika.art/api directs developers there), so this mirrors the
// Kling studio: provider `fal`, the `model` field carries the full fal endpoint id, and the
// adapter spreads `input` straight into the request body. Reuses the org's fal key (Settings →
// Media → fal). Field names are the native fal/Pika request params.
const DURATION = [
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
];
const RESOLUTION = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
];
const ASPECT = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
  { value: '4:5', label: 'Portrait 4:5' },
  { value: '5:4', label: 'Landscape 5:4' },
  { value: '3:2', label: 'Landscape 3:2' },
  { value: '2:3', label: 'Portrait 2:3' },
];
// Pika's signature one-click VFX (fal-ai/pika/v1.5/pikaffects).
const PIKAFFECTS = [
  'Cake-ify', 'Crumble', 'Crush', 'Decapitate', 'Deflate', 'Dissolve', 'Explode', 'Eye-pop',
  'Inflate', 'Levitate', 'Melt', 'Peel', 'Poke', 'Squish', 'Ta-da', 'Tear',
].map((e) => ({ value: e, label: e }));

export const pikaDescriptor: StudioDescriptor = {
  landing: {
    "icon": "pika",
    "website": "https://pika.art",
    "tagline": "Fun, fast AI video for everyone",
    "description": "A playful, accessible AI video platform built around viral creation — best known for Pikaffects, one-tap surreal effects that squish, melt, or transform photos into shareable video.",
    "badges": [
      "Video",
      "Image"
    ],
    "highlights": [
      "Pikaffects: one-tap surreal video effects",
      "Text-to-video and image-to-video generation",
      "Trend-based clips from selfies and audio",
      "Pika 2.5 model for higher-quality output",
      "Designed to make creation accessible to all"
    ]
  },
  provider: 'fal',
  title: 'Pika',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      model: 'fal-ai/pika/v2.2/text-to-video',
      description: 'Generate a video clip from a text prompt with Pika 2.2.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'ugly, bad, terrible' },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: ASPECT },
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
    {
      key: 'pikaffects',
      label: 'Pikaffects',
      operation: 'video',
      model: 'fal-ai/pika/v1.5/pikaffects',
      description: 'Apply a one-click Pika VFX to an image (cake-ify, crush, inflate, melt…).',
      fields: [
        { type: 'media', name: 'image_url', label: 'Source image', accept: 'image', required: true },
        { type: 'select', name: 'pikaffect', label: 'Effect', default: 'Cake-ify', options: PIKAFFECTS },
        { type: 'prompt', name: 'prompt', label: 'Prompt (optional)', placeholder: 'Optional guidance…' },
        { type: 'number', name: 'seed', label: 'Seed (optional)' },
      ],
    },
  ],
};
