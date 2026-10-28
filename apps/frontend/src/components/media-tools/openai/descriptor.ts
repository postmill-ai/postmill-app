import type { StudioDescriptor } from '@postmill-ai/frontend/components/media-tools/studio-kit/types';

// OpenAI media (registry/config identifier `openai`). gpt-image-1 is the image tab; a
// second tab covers TTS (operation `audio`, synchronous data-URL artifact). The DALL·E 3
// tab was removed — the model 404s for new API keys; the adapter still honors an explicit
// `options.model: 'dall-e-3'` for orgs already configured for it. Field names are native
// OpenAI params and ride straight into the request body.
export const openaiDescriptor: StudioDescriptor = {
  landing: {
    "website": "https://openai.com",
    "tagline": "The image model that powers ChatGPT",
    "description": "OpenAI's GPT models for writing, reasoning and vision — plus gpt-image-1 for image generation and natural-sounding TTS voices.",
    "badges": [
      "Image",
      "Audio"
    ],
    "highlights": [
      "gpt-image-1 powers image generation in ChatGPT",
      "Natively multimodal: text + image inputs",
      "Generate and edit existing images by prompt",
      "Text-to-speech voices for narration & audio",
      "Strong instruction-following and world knowledge"
    ]
  },
  provider: 'openai',
  title: 'OpenAI',
  tabs: [
    {
      key: 'gpt-image',
      label: 'GPT Image',
      operation: 'image',
      model: 'gpt-image-1',
      description: 'Generate a still image with gpt-image-1.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Prompt', required: true, placeholder: 'Describe the image…' },
        {
          type: 'select',
          name: 'size',
          label: 'Size',
          default: '1024x1024',
          options: [
            { value: '1024x1024', label: 'Square 1024×1024' },
            { value: '1536x1024', label: 'Landscape 1536×1024' },
            { value: '1024x1536', label: 'Portrait 1024×1536' },
            { value: 'auto', label: 'Auto' },
          ],
        },
        {
          type: 'select',
          name: 'quality',
          label: 'Quality',
          default: 'auto',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ],
        },
        {
          type: 'select',
          name: 'background',
          label: 'Background',
          default: 'auto',
          help: 'Transparent requires PNG or WebP output.',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'transparent', label: 'Transparent' },
            { value: 'opaque', label: 'Opaque' },
          ],
        },
        {
          type: 'select',
          name: 'output_format',
          label: 'Output format',
          default: 'png',
          options: [
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'webp', label: 'WebP' },
          ],
        },
        { type: 'number', name: 'n', label: 'Number of images', min: 1, max: 4, step: 1, default: 1 },
      ],
    },
    {
      key: 'text-to-speech',
      label: 'Text → Speech',
      operation: 'audio',
      description: 'Generate a voiceover with OpenAI TTS. The clip lands in your audio files.',
      fields: [
        { type: 'prompt', name: 'prompt', label: 'Text', required: true, placeholder: 'Type the script to voice…' },
        {
          type: 'select',
          name: 'model',
          label: 'Model',
          default: 'gpt-4o-mini-tts',
          options: [
            { value: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS (latest)' },
            { value: 'tts-1', label: 'TTS-1 (fast)' },
            { value: 'tts-1-hd', label: 'TTS-1 HD (quality)' },
          ],
        },
        {
          type: 'select',
          name: 'voice',
          label: 'Voice',
          default: 'alloy',
          options: [
            { value: 'alloy', label: 'Alloy' },
            { value: 'ash', label: 'Ash' },
            { value: 'ballad', label: 'Ballad' },
            { value: 'coral', label: 'Coral' },
            { value: 'echo', label: 'Echo' },
            { value: 'fable', label: 'Fable' },
            { value: 'nova', label: 'Nova' },
            { value: 'onyx', label: 'Onyx' },
            { value: 'sage', label: 'Sage' },
            { value: 'shimmer', label: 'Shimmer' },
          ],
        },
        {
          type: 'select',
          name: 'response_format',
          label: 'Output format',
          default: 'mp3',
          options: [
            { value: 'mp3', label: 'MP3' },
            { value: 'wav', label: 'WAV' },
          ],
        },
        { type: 'number', name: 'speed', label: 'Speed', min: 0.25, max: 4, step: 0.05, default: 1 },
      ],
    },
  ],
};
