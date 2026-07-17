import type { StudioDescriptor } from '@gitroom/frontend/components/media-tools/studio-kit/types';

// Together AI — image (FLUX family), video (Together /v1/videos async), and TTS, all on the
// org's existing Together LLM key (universal-credential reuse). Model dropdowns are
// populated live from Together's catalog (`source: 'models'`) with curated fallbacks; the
// combobox also accepts a typed model id, since Together's catalog doesn't tag every
// modality. Field names are Together's native API params.
export const togetheraiDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://www.together.ai",
    "tagline": "The AI-native cloud for open-source models",
    "description": "A full-stack inference cloud serving 200+ open-source models through one API — chat, image, audio, and video — with optimized kernels for faster, cheaper generation at scale.",
    "badges": [
      "Image",
      "Video",
      "Audio"
    ],
    "highlights": [
      "200+ open-source models behind one API",
      "Image, video, and audio model support",
      "Up to 2x faster inference with custom kernels",
      "Up to 60% lower cost vs. standard inference",
      "Serverless, dedicated, and batch inference"
    ]
  },
  provider: 'togetherai',
  title: 'Together AI',
  tabs: [
    {
      key: 'text-to-image',
      label: 'Text → Image',
      operation: 'image',
      description: 'Generate an image with FLUX and other Together image models.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'black-forest-labs/FLUX.1-schnell',
          options: [
            { value: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 [schnell]' },
            { value: 'black-forest-labs/FLUX.1-dev', label: 'FLUX.1 [dev]' },
            { value: 'black-forest-labs/FLUX.1.1-pro', label: 'FLUX.1.1 [pro]' },
            { value: 'black-forest-labs/FLUX.2-pro', label: 'FLUX.2 [pro]' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        { type: 'number', name: 'width', label: 'Width', min: 256, max: 2048, step: 16, default: 1024 },
        { type: 'number', name: 'height', label: 'Height', min: 256, max: 2048, step: 16, default: 1024 },
        { type: 'number', name: 'steps', label: 'Steps', min: 1, max: 50, step: 1, help: 'schnell renders in ~4 steps.' },
        { type: 'number', name: 'n', label: 'Images', min: 1, max: 4, step: 1, default: 1 },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
    {
      key: 'text-to-video',
      label: 'Text → Video',
      operation: 'video',
      description: 'Generate a video clip from a text prompt.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the scene…' },
        { type: 'text', name: 'negative_prompt', label: 'Negative prompt', placeholder: 'What to avoid (optional)' },
        {
          type: 'select',
          name: 'ratio',
          label: 'Aspect ratio',
          default: '16:9',
          options: [
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
            { value: '1:1', label: 'Square 1:1' },
          ],
        },
        { type: 'number', name: 'seconds', label: 'Duration (s)', min: 2, max: 30, step: 1, default: 5 },
        { type: 'toggle', name: 'generate_audio', label: 'Generate audio', default: false },
        { type: 'number', name: 'seed', label: 'Seed (optional)', min: 0, max: 2147483647, step: 1 },
      ],
    },
    {
      key: 'image-to-video',
      label: 'Image → Video',
      operation: 'video',
      description: 'Animate a source image into a video clip.',
      fields: [
        { type: 'select', name: 'model', label: 'Model', source: 'models', required: true },
        { type: 'media', name: 'frame_image', label: 'Source image', accept: 'image', required: true },
        { type: 'prompt', name: 'prompt', label: 'Prompt', placeholder: 'Describe the motion…' },
        {
          type: 'select',
          name: 'ratio',
          label: 'Aspect ratio',
          default: '16:9',
          options: [
            { value: '16:9', label: 'Landscape 16:9' },
            { value: '9:16', label: 'Portrait 9:16' },
            { value: '1:1', label: 'Square 1:1' },
          ],
        },
        { type: 'number', name: 'seconds', label: 'Duration (s)', min: 2, max: 30, step: 1, default: 5 },
      ],
    },
    {
      key: 'text-to-speech',
      label: 'Text → Speech',
      operation: 'audio',
      description: 'Generate a voiceover with Together text-to-speech.',
      fields: [
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          source: 'models',
          default: 'cartesia/sonic-2',
          options: [
            { value: 'cartesia/sonic-2', label: 'Cartesia Sonic 2' },
            { value: 'cartesia/sonic', label: 'Cartesia Sonic' },
          ],
        },
        { type: 'prompt', name: 'prompt', label: 'Text', required: true, placeholder: 'Text to speak…' },
        { type: 'text', name: 'voice', label: 'Voice', placeholder: 'e.g. helpful woman' },
        {
          type: 'select',
          name: 'response_format',
          label: 'Format',
          default: 'mp3',
          options: [
            { value: 'mp3', label: 'MP3' },
            { value: 'wav', label: 'WAV' },
          ],
        },
      ],
    },
  ],
};
