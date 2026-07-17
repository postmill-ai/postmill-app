import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Vercel AI Gateway — image (delegated to the AI-SDK gateway provider) and video (AI SDK v6
// experimental generateVideo) on the org's existing Gateway LLM key (universal-credential
// reuse). Models are discovered live from the gateway catalog, filtered per modality.
const RATIOS = [
  { value: '16:9', label: 'Landscape 16:9' },
  { value: '9:16', label: 'Portrait 9:16' },
  { value: '1:1', label: 'Square 1:1' },
];

export const gatewayDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://vercel.com/ai-gateway",
    "tagline": "One API key for hundreds of AI models",
    "description": "Vercel AI Gateway routes requests to hundreds of models across many providers through a single API — text, image, and video — with automatic failover and no platform markup.",
    "badges": [
      "Image",
      "Video"
    ],
    "highlights": [
      "Hundreds of models from many providers",
      "Image generation and editing plus video",
      "Automatic failover during provider outages",
      "No platform fees — pay provider rates",
      "Unified billing, spend tracking & observability"
    ]
  },
  provider: 'gateway',
  title: 'Vercel AI',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image through any gateway image model.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', default: 'openai/gpt-image-1' },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'size',
          label: 'Size',
          default: '1024x1024',
          options: [
            { value: '1024x1024', label: 'Square (1024×1024)' },
            { value: '1536x1024', label: 'Landscape (1536×1024)' },
            { value: '1024x1536', label: 'Portrait (1024×1536)' },
          ],
        },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 4, step: 1, default: 1 },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video (Veo, Kling, Wan, Seedance…). Renders may take minutes.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', default: 'google/veo-3.1-generate-001' },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'number', name: 'seconds', label: 'Duration (s)', min: 2, max: 30, step: 1, default: 8 },
        { type: 'select', name: 'aspect_ratio', label: 'Aspect ratio', default: '16:9', options: RATIOS },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', default: 'bytedance/seedance-v1.5-pro' },
        { type: 'media', name: 'image', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        { type: 'number', name: 'seconds', label: 'Duration (s)', min: 2, max: 30, step: 1, default: 8 },
      ],
    },
  ],
};
