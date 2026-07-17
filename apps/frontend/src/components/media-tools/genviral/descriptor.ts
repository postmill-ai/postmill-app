import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Genviral Partner API (Studio AI video). `model` is required and populated live from Genviral's
// catalog (`source: 'models'`) — it routes to underlying providers (fal / Sora / Seedance, etc.).
// Field names are Genviral's native params: `model` → `model_id`, `prompt`, the optional media
// fields `image_url` / `audio_url`, `negative_prompt`, and the resolution/duration/fps/aspect_ratio/
// generate_audio fields (nested under `params` server-side — see genviral.adapter.ts). The model
// combobox also accepts a typed model id, so an incomplete catalog never blocks a render.
const ASPECT_RATIOS = [
  { value: '9:16', label: '9:16 · Vertical' },
  { value: '16:9', label: '16:9 · Landscape' },
  { value: '1:1', label: '1:1 · Square' },
];

export const genviralDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://www.genviral.io',
    tagline: 'AI video generation + multi-platform publishing',
    description:
      'Genviral Studio AI generates short-form videos from a prompt, routing to top video models (Sora, Seedance, and more). Configure your Genviral Partner API key to generate straight into your media library.',
    badges: ['Video'],
    highlights: [
      'Prompt → AI video',
      'Live model catalog (Sora, Seedance, …)',
      'Image-to-video and reference inputs',
      'Lands in your /files library',
    ],
  },
  provider: 'genviral',
  title: 'Genviral',
  tabs: [
    {
      key: 'video',
      label: 'Prompt → Video',
      operation: 'video',
      description: 'Generate a short-form video with Genviral Studio AI.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          required: true,
          options: [
            { value: 'openai/sora-2', label: 'OpenAI Sora 2' },
            { value: 'bytedance/seedance-2.0', label: 'ByteDance Seedance 2.0' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the video…' },
        { type: 'media', name: 'image_url', label: 'Source image (image-to-video, optional)', accept: 'image' },
        { type: 'media', name: 'audio_url', label: 'Audio track (optional)', accept: 'audio' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt (optional)', placeholder: 'What to avoid…' },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '9:16', options: ASPECT_RATIOS },
        { type: 'number', name: 'duration_seconds', label: 'Duration (seconds)', min: 1, max: 60, default: 5 },
        { type: 'number', name: 'fps', label: 'Frame rate (fps)', min: 12, max: 60, default: 30 },
        { type: 'toggle', name: 'generate_audio', label: 'Generate audio', default: true },
      ],
    },
  ],
};
