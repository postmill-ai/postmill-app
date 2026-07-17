import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// xAI (Grok) — image generation via the OpenAI-compatible `/v1/images/generations` endpoint on
// the org's existing xAI LLM key (universal-credential reuse). xAI's image API takes only
// model / prompt / n, so the form stays minimal; image models are discovered live.
export const xaiDescriptor: StudioDescriptor = {
  landing: {
    website: 'https://x.ai',
    tagline: "Grok's image generation from xAI",
    description:
      "xAI builds Grok, the AI assistant from Elon Musk's xAI with real-time knowledge of the world. Its image model (Aurora) renders photorealistic, prompt-faithful images directly from the same API key as the Grok chat models.",
    badges: ['Image'],
    highlights: [
      'Photorealistic image generation from a text prompt',
      'Powered by xAI’s Aurora autoregressive image model',
      'Strong prompt adherence and coherent detail',
      'Generate up to 10 variations per request',
      'Reuses your existing Settings → AI Grok key',
    ],
  },
  provider: 'xai',
  title: 'xAI Grok',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate images with Grok (Aurora).',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'grok-2-image-1212',
          options: [{ value: 'grok-2-image-1212', label: 'Grok 2 Image' }],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 10, step: 1, default: 1 },
      ],
    },
  ],
};
