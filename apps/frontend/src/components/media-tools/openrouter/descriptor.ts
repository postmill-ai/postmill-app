import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// OpenRouter — image generation via the dedicated `/api/v1/images` endpoint on the org's
// existing OpenRouter LLM key (universal-credential reuse). Image models are discovered live
// (catalog filtered to image-output models).
export const openrouterDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://openrouter.ai",
    "tagline": "One API for any AI model",
    "description": "A unified gateway to 400+ models from 70+ providers through a single OpenAI-compatible API — including a dedicated image API spanning 30+ models — with automatic failover.",
    "badges": [
      "Image"
    ],
    "highlights": [
      "400+ models from 70+ providers, one API",
      "Image API across 30+ models, 8 providers",
      "Automatic fallbacks for higher availability",
      "OpenAI SDK works out of the box",
      "Better prices and custom data policies"
    ]
  },
  provider: 'openrouter',
  title: 'OpenRouter',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with any OpenRouter image model.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'openai/gpt-image-1',
          options: [
            { value: 'openai/gpt-image-1', label: 'OpenAI gpt-image-1' },
            { value: 'black-forest-labs/flux.2-pro', label: 'FLUX.2 [pro]' },
            { value: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 10, step: 1, default: 1 },
        {
          type: 'select',
          name: 'aspect_ratio',
          label: 'Aspect ratio',
          default: '1:1',
          options: [
            { value: '1:1', label: 'Square 1:1' },
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
          ],
        },
        {
          type: 'select',
          name: 'resolution',
          label: 'Resolution',
          default: '1K',
          options: [
            { value: '512', label: '512' },
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
          ],
        },
        {
          type: 'select',
          name: 'output_format',
          label: 'Format',
          default: 'png',
          options: [
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'webp', label: 'WebP' },
          ],
        },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
  ],
};
