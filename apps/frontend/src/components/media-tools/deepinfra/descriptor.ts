import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// DeepInfra — image, video and TTS via DeepInfra's native per-model inference endpoint, on
// the org's existing DeepInfra LLM key (universal-credential reuse). The model id is the
// DeepInfra model path (curated lists + free entry).
export const deepinfraDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://deepinfra.com",
    "tagline": "Run the best AI models at the lowest cost",
    "description": "A developer-friendly inference hub serving 100+ models across text, image, video, and speech via simple APIs — pay-as-you-go on its own cost-optimized US infrastructure.",
    "badges": [
      "Image",
      "Video",
      "Audio"
    ],
    "highlights": [
      "100+ models across every modality",
      "Text-to-image, text-to-video, TTS and STT",
      "Low pay-as-you-go pricing, no hidden fees",
      "Zero-retention, SOC 2 & ISO 27001 certified",
      "Own inference-optimized US data centers"
    ]
  },
  provider: 'deepinfra',
  title: 'DeepInfra',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with FLUX and other DeepInfra image models.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'black-forest-labs/FLUX-1-schnell',
          options: [
            { value: 'black-forest-labs/FLUX-1-schnell', label: 'FLUX.1 [schnell]' },
            { value: 'black-forest-labs/FLUX-1-dev', label: 'FLUX.1 [dev]' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'number', name: 'width', label: 'Width', min: 256, max: 2048, step: 64, default: 1024 },
        { type: 'number', name: 'height', label: 'Height', min: 256, max: 2048, step: 64, default: 1024 },
        { type: 'number', name: 'num_inference_steps', label: 'Steps', min: 1, max: 50, step: 1 },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'google/veo-3.1',
          options: [
            { value: 'google/veo-3.1', label: 'Veo 3.1' },
            { value: 'pixverse/pixverse-v6', label: 'PixVerse V6' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
      ],
    },
    {
      key: 'text-to-speech',
      label: 'Text → Speech',
      operation: 'audio',
      description: 'Generate a voiceover with DeepInfra TTS.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'hexgrad/Kokoro-82M',
          options: [{ value: 'hexgrad/Kokoro-82M', label: 'Kokoro 82M' }],
        },
        { type: 'prompt', name: 'prompt', label: 'Text', required: true, placeholder: 'Text to speak…' },
        { type: 'text', name: 'preset_voice', label: 'Voice', placeholder: 'e.g. af_bella' },
      ],
    },
  ],
};
