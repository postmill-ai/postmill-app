import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Sora (OpenAI). Reuses the registry/config identifier `openai` (the org's existing Settings → AI /
// Media OpenAI key) — like Pika rides the `fal` provider — so no separate credential is needed.
// Field names are native OpenAI Videos params; the model selects the Sora variant. `input_reference`
// is the optional source frame (image-to-video), uploaded as a multipart file by the adapter.

const SIZES = [
  { value: '1280x720', label: 'Landscape 1280×720' },
  { value: '720x1280', label: 'Portrait 720×1280' },
  { value: '1920x1080', label: 'Landscape 1920×1080 (Pro)' },
  { value: '1080x1920', label: 'Portrait 1080×1920 (Pro)' },
];

// seconds is a string param in the Videos API.
const SECONDS = [
  { value: '4', label: '4 seconds' },
  { value: '8', label: '8 seconds' },
  { value: '12', label: '12 seconds' },
];

const MODELS = [
  { value: 'sora-2', label: 'Sora 2' },
  { value: 'sora-2-pro', label: 'Sora 2 Pro' },
];

export const soraDescriptor: StudioDescriptor = {
  landing: {
    "icon": "sora",
    "website": "https://openai.com/sora/",
    "tagline": "OpenAI's flagship text-to-video model",
    "description": "OpenAI's video model — Sora 2 delivers far more realistic, physically accurate, and controllable video, plus synchronized dialogue and sound effects from a simple text prompt.",
    "badges": [
      "Video"
    ],
    "highlights": [
      "Sora 2: realistic, physically accurate motion",
      "Text-to-video and image-to-video generation",
      "Synchronized dialogue and sound effects",
      "Strong world physics and scene controllability",
      "From the makers of ChatGPT"
    ]
  },
  provider: 'openai',
  title: 'Sora',
  tabs: [
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video from a text prompt with OpenAI Sora.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene — subjects, camera, lighting, motion…' },
        { type: 'select', name: 'model', label: 'Model', default: 'sora-2', options: MODELS },
        { type: 'select', name: 'size', label: 'Resolution', default: '1280x720', options: SIZES },
        { type: 'select', name: 'seconds', label: 'Duration', default: '8', options: SECONDS },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip with OpenAI Sora.',
      fields: [
        { type: 'media', name: 'input_reference', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the motion…' },
        { type: 'select', name: 'model', label: 'Model', default: 'sora-2', options: MODELS },
        { type: 'select', name: 'size', label: 'Resolution', default: '1280x720', options: SIZES },
        { type: 'select', name: 'seconds', label: 'Duration', default: '8', options: SECONDS },
      ],
    },
  ],
};
